from __future__ import annotations

import hashlib
import logging
import re

from anthropic import AsyncAnthropic
from playwright.async_api import async_playwright

from .config import settings
from .models import FieldType, FormField, FormSchema
from .nav_engine import navigate_to_next_page, new_navigation_context
from .page_model import get_page_snapshot

logger = logging.getLogger(__name__)

_FIELD_TYPE_MAP: dict[str, FieldType] = {
    "short_text": FieldType.short_text,
    "long_text": FieldType.long_text,
    "radio": FieldType.radio,
    "checkbox": FieldType.checkbox,
    "dropdown": FieldType.dropdown,
    "linear_scale": FieldType.linear_scale,
    "date": FieldType.date,
    "time": FieldType.time,
}

_CLASSIFY_SYSTEM_PROMPT = """\
You are a form-field classifier. You receive a JSON array of raw DOM elements \
extracted from a web page. Your job is to identify which elements are real, \
user-facing form fields (ignoring hidden inputs, CSRF tokens, honeypots, \
viewstate fields, and non-interactive chrome).

For each real field, call the provided tool once with the full list of classified fields.

Rules:
- Include fields even if is_visible is false, as long as they appear to be real \
user-facing form fields (many forms use JavaScript to dynamically show/hide \
sections based on earlier answers). Only skip hidden elements that are clearly \
framework internals or non-interactive.
- Skip elements whose name or id suggests they are framework internals \
(e.g. __VIEWSTATE, __EVENTVALIDATION, __RequestVerificationToken, csrf, honeypot).
- Assign a human-readable label from the best available source: \
explicit label text > aria-label > placeholder > name/id cleaned up.
- Map each field to one of: short_text, long_text, radio, checkbox, dropdown, \
linear_scale, date, time.
- Determine required status from the required attribute, aria-required, \
or asterisks/\"required\" in the label text.
- For select/radio/checkbox groups, include the options list.
"""

_CLASSIFY_TOOL_NAME = "classify_form_fields"
_CLASSIFY_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "fields": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "element_index": {
                        "type": "integer",
                        "description": "Index into the original elements array",
                    },
                    "label": {"type": "string"},
                    "field_type": {
                        "type": "string",
                        "enum": list(_FIELD_TYPE_MAP.keys()),
                    },
                    "required": {"type": "boolean"},
                    "options": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": ["element_index", "label", "field_type", "required"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["fields"],
    "additionalProperties": False,
}

# JavaScript to extract all form-like elements from the DOM.
# Wrapped in a top-level try/catch so evaluate() never returns None.
# Uses a safe CSS escape fallback for older/quirky pages.
_DOM_EXTRACTION_JS = """
() => {
  try {
    const normalize = (v) => (v || '').replace(/\\s+/g, ' ').trim();
    const escapeCSS = (v) => {
      try { return CSS.escape(v); } catch(_) { return v.replace(/"/g, '\\\\"'); }
    };

    const isVisible = (el) => {
      try {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      } catch(_) { return false; }
    };

    const getLabelFor = (el) => {
      try {
        if (el.id) {
          const label = document.querySelector('label[for="' + escapeCSS(el.id) + '"]');
          if (label) return normalize(label.innerText || label.textContent);
        }
        const parent = el.closest('label');
        if (parent) {
          const clone = parent.cloneNode(true);
          const inputs = clone.querySelectorAll('input, select, textarea');
          inputs.forEach(i => i.remove());
          return normalize(clone.innerText || clone.textContent);
        }
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) return normalize(ariaLabel);
        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          const parts = labelledBy.split(/\\s+/).map(id => {
            const ref = document.getElementById(id);
            return ref ? normalize(ref.innerText || ref.textContent) : '';
          }).filter(Boolean);
          if (parts.length) return parts.join(' ');
        }
      } catch(_) {}
      return '';
    };

    const getSurroundingText = (el) => {
      try {
        const prev = el.previousElementSibling;
        if (prev && ['LABEL', 'SPAN', 'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(prev.tagName)) {
          const text = normalize(prev.innerText || prev.textContent);
          if (text && text.length < 200) return text;
        }
        const parent = el.parentElement;
        if (parent) {
          for (const child of parent.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
              const text = normalize(child.textContent);
              if (text && text.length > 2 && text.length < 200) return text;
            }
          }
        }
      } catch(_) {}
      return '';
    };

    const getOptions = (el) => {
      try {
        if (el.tagName === 'SELECT') {
          return Array.from(el.options)
            .map(o => normalize(o.text || o.value))
            .filter(Boolean);
        }
        if (el.type === 'radio' || el.type === 'checkbox') {
          const name = el.getAttribute('name');
          if (!name) return [];
          const group = document.querySelectorAll('input[name="' + escapeCSS(name) + '"]');
          return Array.from(group).map(inp => {
            const lbl = getLabelFor(inp);
            return lbl || normalize(inp.value);
          }).filter(Boolean);
        }
        const role = (el.getAttribute('role') || '').toLowerCase();
        if (role === 'listbox' || role === 'radiogroup' || role === 'group') {
          const items = el.querySelectorAll('[role="option"], [role="radio"], [role="checkbox"]');
          return Array.from(items).map(item => {
            return normalize(item.getAttribute('aria-label') || item.innerText || item.textContent);
          }).filter(Boolean);
        }
      } catch(_) {}
      return [];
    };

    const elements = [];
    const seenNames = new Set();

    const selectors = 'input, select, textarea, [role="listbox"], [role="radiogroup"], [role="combobox"], [role="spinbutton"]';
    const nodes = document.querySelectorAll(selectors);

    nodes.forEach((el, idx) => {
      try {
        const tag = el.tagName.toLowerCase();
        const type = normalize(el.getAttribute('type') || '').toLowerCase();

        if (tag === 'input' && ['submit', 'reset', 'button', 'image'].includes(type)) return;

        if ((type === 'radio' || type === 'checkbox') && el.name) {
          if (seenNames.has(el.name)) return;
          seenNames.add(el.name);
        }

        const name = normalize(el.getAttribute('name'));
        const id = normalize(el.getAttribute('id'));
        const placeholder = normalize(el.getAttribute('placeholder'));
        const label = getLabelFor(el);
        const surroundingText = getSurroundingText(el);
        const required = el.hasAttribute('required') || el.getAttribute('aria-required') === 'true';
        const role = normalize(el.getAttribute('role') || '').toLowerCase();
        const options = getOptions(el);

        elements.push({
          index: idx,
          tag,
          type: type || (tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : ''),
          name,
          id,
          placeholder,
          label,
          aria_label: normalize(el.getAttribute('aria-label') || ''),
          surrounding_text: surroundingText,
          required,
          is_visible: isVisible(el),
          role,
          options,
          value: tag === 'select' ? '' : normalize((el.value != null ? el.value : '') + ''),
        });
      } catch(_) {}
    });

    const title = normalize(document.title || '');
    const h1 = document.querySelector('h1');
    const heading = h1 ? normalize(h1.innerText || h1.textContent) : '';

    return { elements, title, heading };
  } catch(e) {
    return { elements: [], title: '', heading: '', error: String(e) };
  }
}
"""


def _field_dedup_key(field: FormField) -> str:
    label = re.sub(r"\s+", " ", field.label).strip().lower()
    opts = "|".join(sorted(o.lower().strip() for o in field.options)) if field.options else ""
    return f"{label}\x00{field.field_type.value}\x00{opts}"


def _make_field_id(element: dict, index: int, page_index: int) -> str:
    name = element.get("name", "")
    el_id = element.get("id", "")
    if name:
        return name
    if el_id:
        return el_id
    return f"generic_{page_index}_{index}"


async def _classify_fields_with_ai(
    raw_elements: list[dict],
) -> list[dict]:
    """Send extracted DOM elements to Claude for classification."""
    if not settings.anthropic_api_key:
        raise ValueError("ANTHROPIC_API_KEY is not configured.")

    if not raw_elements:
        return []

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)

    # Build a compact representation for the AI
    compact = []
    for el in raw_elements:
        compact.append({
            "index": el["index"],
            "tag": el["tag"],
            "type": el["type"],
            "name": el["name"],
            "id": el["id"],
            "placeholder": el["placeholder"],
            "label": el["label"],
            "aria_label": el["aria_label"],
            "surrounding_text": el["surrounding_text"],
            "required": el["required"],
            "is_visible": el["is_visible"],
            "role": el["role"],
            "options": el["options"][:50],  # cap options to limit tokens
        })

    import json
    user_prompt = (
        "Here are the raw form elements extracted from a web page. "
        "Classify which ones are real user-facing form fields.\n\n"
        f"```json\n{json.dumps(compact, indent=2)}\n```"
    )

    response = await client.messages.create(
        model=settings.model_name,
        max_tokens=4096,
        temperature=0,
        system=_CLASSIFY_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
        tools=[
            {
                "name": _CLASSIFY_TOOL_NAME,
                "description": "Return the list of classified real form fields.",
                "input_schema": _CLASSIFY_TOOL_SCHEMA,
            }
        ],
        tool_choice={"type": "tool", "name": _CLASSIFY_TOOL_NAME},
    )

    for block in response.content:
        if getattr(block, "type", "") != "tool_use":
            continue
        if getattr(block, "name", "") != _CLASSIFY_TOOL_NAME:
            continue
        payload = getattr(block, "input", {})
        return payload.get("fields", [])

    return []


async def scrape_generic_form(url: str) -> FormSchema:
    """Scrape an arbitrary web form URL and return its schema."""
    scrape_warnings: list[str] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=settings.generic_playwright_headless,
        )
        page = await browser.new_page()

        # Navigate with networkidle, fall back to domcontentloaded
        try:
            await page.goto(
                url,
                wait_until="networkidle",
                timeout=settings.generic_page_load_timeout_ms,
            )
        except Exception:
            try:
                await page.goto(
                    url,
                    wait_until="domcontentloaded",
                    timeout=settings.generic_page_load_timeout_ms,
                )
                scrape_warnings.append(
                    "Page did not reach network idle; loaded with domcontentloaded fallback."
                )
            except Exception as e:
                await browser.close()
                raise ValueError(f"Failed to load page: {e}")

        # Extra wait for JS-heavy pages (ASP.NET/jQuery pages need more time)
        await page.wait_for_timeout(3000)
        # Best-effort wait for actual form elements to appear in the DOM
        try:
            await page.wait_for_selector('input, select, textarea', timeout=5000)
        except Exception:
            pass

        page_index = 0
        all_fields: list[FormField] = []
        seen_fields: set[str] = set()
        nav_context = new_navigation_context(url)
        seen_signatures: set[str] = set()

        max_pages = settings.generic_nav_max_pages

        while page_index < max_pages:
            # Extract DOM elements
            try:
                raw = await page.evaluate(_DOM_EXTRACTION_JS)
            except Exception as e:
                scrape_warnings.append(f"DOM extraction failed on page {page_index + 1}: {e}")
                break

            raw_elements: list[dict] = raw.get("elements", [])
            page_title = raw.get("heading") or raw.get("title") or "Untitled Form"

            if raw_elements:
                # Classify with AI
                try:
                    classified = await _classify_fields_with_ai(raw_elements)
                except Exception as e:
                    scrape_warnings.append(f"AI classification failed: {e}")
                    classified = []

                if raw_elements and not classified:
                    scrape_warnings.append(
                        f"Extracted {len(raw_elements)} raw DOM elements on page {page_index + 1} "
                        "but AI classified none as user-facing fields."
                    )

                for cf in classified:
                    el_idx = cf.get("element_index", -1)
                    # Find original element for ID generation
                    original = next(
                        (el for el in raw_elements if el.get("index") == el_idx),
                        {},
                    )

                    field_type_str = cf.get("field_type", "short_text")
                    field_type = _FIELD_TYPE_MAP.get(field_type_str, FieldType.short_text)

                    field = FormField(
                        field_id=_make_field_id(original, el_idx, page_index),
                        label=cf.get("label", f"Field {el_idx}"),
                        field_type=field_type,
                        required=cf.get("required", False),
                        options=cf.get("options", []),
                        page_index=page_index,
                    )

                    key = _field_dedup_key(field)
                    if key not in seen_fields:
                        seen_fields.add(key)
                        all_fields.append(field)

            # Check for multi-page navigation
            if page_index == 0 and max_pages <= 1:
                break

            snapshot = await get_page_snapshot(page)

            if snapshot.signature in seen_signatures:
                scrape_warnings.append(
                    "Detected repeated page structure. Stopped to avoid an infinite loop."
                )
                break
            seen_signatures.add(snapshot.signature)

            nav_outcome = await navigate_to_next_page(page, nav_context, snapshot)
            if nav_outcome.moved:
                page_index += 1
                await page.wait_for_timeout(1000)
                continue

            # No further pages
            break

        await browser.close()

    if not all_fields:
        scrape_warnings.append(
            "No form fields were detected on this page. "
            "The page may not contain a form, may require login, "
            "or its structure may not be supported."
        )

    return FormSchema(
        title=page_title if page_index == 0 else page_title,
        description="",
        fields=all_fields,
        page_count=page_index + 1,
        url=url,
        provider="generic",
        scrape_warnings=scrape_warnings,
    )
