// ---------------------------------------------------------------------------
// generic-form-scraper.ts — Generic web form scraper via Playwright + Claude AI
//
// Launches a headless browser, extracts all form-like DOM elements, sends them
// to Claude for classification, and returns a structured FormSchema.
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import { chromium } from "playwright";

import { settings } from "./config";
import type { FieldType, FormField, FormSchema } from "./models";
import { navigateToNextPage, newNavigationContext } from "./nav-engine";
import { getPageSnapshot } from "./page-model";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_FIELD_TYPES = new Set<string>([
  "short_text",
  "long_text",
  "radio",
  "checkbox",
  "dropdown",
  "linear_scale",
  "date",
  "time",
]);

const CLASSIFY_SYSTEM_PROMPT = `You are a form-field classifier. You receive a JSON array of raw DOM elements \
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
or asterisks/"required" in the label text.
- For select/radio/checkbox groups, include the options list.
`;

const CLASSIFY_TOOL_NAME = "classify_form_fields";

const CLASSIFY_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    fields: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          element_index: {
            type: "integer" as const,
            description: "Index into the original elements array",
          },
          label: { type: "string" as const },
          field_type: {
            type: "string" as const,
            enum: Array.from(VALID_FIELD_TYPES),
          },
          required: { type: "boolean" as const },
          options: {
            type: "array" as const,
            items: { type: "string" as const },
          },
        },
        required: [
          "element_index",
          "label",
          "field_type",
          "required",
        ] as const,
        additionalProperties: false as const,
      },
    },
  },
  required: ["fields"] as const,
  additionalProperties: false as const,
};

// JavaScript injected into the page to extract form elements.
// Wrapped in a top-level try/catch so evaluate() never returns undefined.
// Avoids CSS.escape (not available in all contexts) — uses a simple fallback.
const DOM_EXTRACTION_JS = `
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
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _fieldDedupKey(field: FormField): string {
  const label = (field.label || "").replace(/\s+/g, " ").trim().toLowerCase();
  const opts = field.options
    ? field.options
        .map((o) => o.toLowerCase().trim())
        .sort()
        .join("|")
    : "";
  return `${label}\x00${field.field_type}\x00${opts}`;
}

function _makeFieldId(
  element: Record<string, unknown>,
  index: number,
  pageIndex: number,
): string {
  const name = element.name as string;
  const id = element.id as string;
  if (name) return name;
  if (id) return id;
  return `generic_${pageIndex}_${index}`;
}

// ---------------------------------------------------------------------------
// AI classification
// ---------------------------------------------------------------------------

interface ClassifiedField {
  element_index: number;
  label: string;
  field_type: string;
  required: boolean;
  options?: string[];
}

async function _classifyFieldsWithAI(
  rawElements: Record<string, unknown>[],
): Promise<ClassifiedField[]> {
  if (!settings.anthropic_api_key) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }
  if (rawElements.length === 0) return [];

  const client = new Anthropic({ apiKey: settings.anthropic_api_key });

  const compact = rawElements.map((el) => ({
    index: el.index,
    tag: el.tag,
    type: el.type,
    name: el.name,
    id: el.id,
    placeholder: el.placeholder,
    label: el.label,
    aria_label: el.aria_label,
    surrounding_text: el.surrounding_text,
    required: el.required,
    is_visible: el.is_visible,
    role: el.role,
    options: (el.options as string[] | undefined)?.slice(0, 50) ?? [],
  }));

  const userPrompt =
    "Here are the raw form elements extracted from a web page. " +
    "Classify which ones are real user-facing form fields.\n\n" +
    "```json\n" +
    JSON.stringify(compact, null, 2) +
    "\n```";

  const response = await client.messages.create({
    model: settings.model_name,
    max_tokens: 4096,
    temperature: 0,
    system: CLASSIFY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    tools: [
      {
        name: CLASSIFY_TOOL_NAME,
        description: "Return the list of classified real form fields.",
        input_schema: CLASSIFY_TOOL_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: CLASSIFY_TOOL_NAME },
  });

  for (const block of response.content) {
    if (block.type !== "tool_use") continue;
    if (block.name !== CLASSIFY_TOOL_NAME) continue;
    const payload = block.input as { fields?: ClassifiedField[] };
    return payload.fields ?? [];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function scrapeGenericForm(url: string): Promise<FormSchema> {
  const scrapeWarnings: string[] = [];

  const browser = await chromium.launch({
    headless: settings.generic_playwright_headless,
  });
  const page = await browser.newPage();

  try {
    // Navigate with networkidle, fall back to domcontentloaded
    try {
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: settings.generic_page_load_timeout_ms,
      });
    } catch {
      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: settings.generic_page_load_timeout_ms,
        });
        scrapeWarnings.push(
          "Page did not reach network idle; loaded with domcontentloaded fallback.",
        );
      } catch (e) {
        throw new Error(`Failed to load page: ${e}`);
      }
    }

    // Extra wait for JS-heavy pages (ASP.NET/jQuery pages need more time)
    await page.waitForTimeout(3000);
    // Best-effort wait for actual form elements to appear in the DOM
    await page.waitForSelector('input, select, textarea', { timeout: 5000 }).catch(() => {});

    let pageIndex = 0;
    const allFields: FormField[] = [];
    const seenFields = new Set<string>();
    const navContext = newNavigationContext(url);
    const seenSignatures = new Set<string>();
    const maxPages = settings.generic_nav_max_pages;
    let pageTitle = "Untitled Form";

    while (pageIndex < maxPages) {
      // Extract DOM elements
      let raw: {
        elements: Record<string, unknown>[];
        title: string;
        heading: string;
      } | null = null;
      try {
        raw = await page.evaluate(DOM_EXTRACTION_JS);
      } catch (e) {
        scrapeWarnings.push(
          `DOM extraction failed on page ${pageIndex + 1}: ${e}`,
        );
        break;
      }

      if (!raw || typeof raw !== "object") {
        scrapeWarnings.push(
          `DOM extraction returned no data on page ${pageIndex + 1}.`,
        );
        break;
      }

      const rawElements = raw.elements ?? [];
      if (pageIndex === 0) {
        pageTitle = raw.heading || raw.title || "Untitled Form";
      }

      if (rawElements.length > 0) {
        let classified: ClassifiedField[] = [];
        try {
          classified = await _classifyFieldsWithAI(rawElements);
        } catch (e) {
          scrapeWarnings.push(`AI classification failed: ${e}`);
        }

        if (rawElements.length > 0 && classified.length === 0) {
          scrapeWarnings.push(
            `Extracted ${rawElements.length} raw DOM elements on page ${pageIndex + 1} but AI classified none as user-facing fields.`,
          );
        }

        for (const cf of classified) {
          const elIdx = cf.element_index ?? -1;
          const original =
            rawElements.find(
              (el) => (el.index as number) === elIdx,
            ) ?? {};

          const fieldType: FieldType = VALID_FIELD_TYPES.has(cf.field_type)
            ? (cf.field_type as FieldType)
            : "short_text";

          const field: FormField = {
            field_id: _makeFieldId(original, elIdx, pageIndex),
            label: cf.label || `Field ${elIdx}`,
            field_type: fieldType,
            required: cf.required ?? false,
            options: cf.options ?? [],
            page_index: pageIndex,
          };

          const key = _fieldDedupKey(field);
          if (!seenFields.has(key)) {
            seenFields.add(key);
            allFields.push(field);
          }
        }
      }

      // Check for multi-page navigation
      if (pageIndex === 0 && maxPages <= 1) break;

      const snapshot = await getPageSnapshot(page);

      if (seenSignatures.has(snapshot.signature)) {
        scrapeWarnings.push(
          "Detected repeated page structure. Stopped to avoid an infinite loop.",
        );
        break;
      }
      seenSignatures.add(snapshot.signature);

      const navOutcome = await navigateToNextPage(
        page,
        navContext,
        snapshot,
      );
      if (navOutcome.moved) {
        pageIndex += 1;
        await page.waitForTimeout(1000);
        continue;
      }

      // No further pages
      break;
    }

    if (allFields.length === 0) {
      scrapeWarnings.push(
        "No form fields were detected on this page. " +
          "The page may not contain a form, may require login, " +
          "or its structure may not be supported.",
      );
    }

    return {
      title: pageTitle,
      description: "",
      fields: allFields,
      page_count: pageIndex + 1,
      url,
      provider: "generic",
      scrape_warnings: scrapeWarnings,
    };
  } finally {
    await browser.close();
  }
}
