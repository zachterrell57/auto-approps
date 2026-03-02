// ---------------------------------------------------------------------------
// generic-form-scraper.ts — Generic web form scraper via Playwright + Claude AI
//
// Launches a headless browser, extracts all form-like DOM elements, sends them
// to Claude for classification, and returns a structured FormSchema.
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import { chromium, type Frame, type Page } from "playwright";

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

const CLASSIFY_BATCH_SIZE = 70;
const GENERIC_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0.0.0 Safari/537.36";
const INTERNAL_FIELD_NAME_RE =
  /(?:^|[_$-])(?:__viewstate|__eventvalidation|__eventtarget|__eventargument|__lastfocus|requestverificationtoken|csrf|xsrf|honeypot|recaptcha)(?:$|[_$-])/i;
const GENERIC_LABEL_RE = /^(?:required|optional|\*+)$/i;

// JavaScript injected into the page to extract form elements.
// Wrapped in a top-level try/catch so evaluate() never returns undefined.
// Avoids CSS.escape (not available in all contexts) — uses a simple fallback.
const DOM_EXTRACTION_JS = `
() => {
  try {
    const normalize = (v) => (v || '').replace(/\\s+/g, ' ').trim();
    const escapeCSS = (v) => {
      try { return CSS.escape(v); } catch(_) { return (v || '').replace(/"/g, '\\\\"'); }
    };

    const textWithoutControls = (node) => {
      try {
        if (!node) return '';
        const clone = node.cloneNode(true);
        const controls = clone.querySelectorAll(
          'input, select, textarea, button, [role="button"], [role="textbox"], [role="listbox"], [role="combobox"], [role="spinbutton"]',
        );
        controls.forEach((control) => control.remove());
        return normalize(clone.innerText || clone.textContent);
      } catch(_) {
        return '';
      }
    };

    const normalizeLabelText = (value) => {
      let out = normalize(value);
      if (!out) return '';
      out = out.replace(/^\\*+\\s*/, '');
      out = out.replace(/^required\\s+/i, '');
      out = normalize(out);
      if (!out) return '';
      if (/^(required|optional|\\*+)$/i.test(out)) return '';
      return out;
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
          if (label) {
            const text = normalizeLabelText(label.innerText || label.textContent);
            if (text) return text;
          }
        }
        const parent = el.closest('label');
        if (parent) {
          const text = normalizeLabelText(textWithoutControls(parent));
          if (text) return text;
        }
        const fieldset = el.closest('fieldset');
        if (fieldset) {
          const legend = fieldset.querySelector('legend');
          if (legend) {
            const text = normalizeLabelText(legend.innerText || legend.textContent);
            if (text) return text;
          }
        }
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) {
          const text = normalizeLabelText(ariaLabel);
          if (text) return text;
        }
        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          const parts = labelledBy.split(/\\s+/).map(id => {
            const ref = document.getElementById(id);
            return ref ? normalizeLabelText(ref.innerText || ref.textContent) : '';
          }).filter(Boolean);
          if (parts.length) return parts.join(' ');
        }

        const tableCell = el.closest('td, th');
        if (tableCell) {
          const row = tableCell.parentElement;
          if (row) {
            const cells = Array.from(row.children).filter(child => child && ['TD', 'TH'].includes(child.tagName));
            const idx = cells.indexOf(tableCell);
            for (let i = idx - 1; i >= 0; i--) {
              const text = normalizeLabelText(textWithoutControls(cells[i]));
              if (text) return text;
            }
          }
        }

        let cursor = el;
        for (let depth = 0; depth < 3 && cursor; depth++) {
          let sibling = cursor.previousElementSibling;
          while (sibling) {
            const text = normalizeLabelText(textWithoutControls(sibling));
            if (text) return text;
            sibling = sibling.previousElementSibling;
          }
          cursor = cursor.parentElement;
        }
      } catch(_) {}
      return '';
    };

    const getSurroundingText = (el) => {
      try {
        let cursor = el;
        for (let depth = 0; depth < 3 && cursor; depth++) {
          let sibling = cursor.previousElementSibling;
          while (sibling) {
            const text = normalizeLabelText(textWithoutControls(sibling));
            if (text && text.length < 240) return text;
            sibling = sibling.previousElementSibling;
          }
          cursor = cursor.parentElement;
        }

        const parent = el.parentElement;
        if (parent) {
          for (const child of parent.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
              const text = normalizeLabelText(child.textContent);
              if (text && text.length > 2 && text.length < 240) return text;
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

        if (tag === 'input' && ['submit', 'reset', 'button', 'image', 'hidden'].includes(type)) return;

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

type RawElement = Record<string, unknown>;

interface RawExtractionResult {
  elements: RawElement[];
  title: string;
  heading: string;
  frame_count: number;
  frame_errors: string[];
}

function _normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function _normalizeOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const options: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const cleaned = _normalizeText(item);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(cleaned);
  }
  return options;
}

function _isGenericLabel(value: string): boolean {
  return GENERIC_LABEL_RE.test(value.trim());
}

function _stripRequiredPrefix(value: string): string {
  let cleaned = _normalizeText(value);
  if (!cleaned) return "";
  cleaned = cleaned.replace(/^\*+\s*/, "");
  const withoutRequired = cleaned.replace(/^required\s+/i, "");
  const normalized = _normalizeText(withoutRequired);
  if (normalized) return normalized;
  return _normalizeText(cleaned);
}

function _humanizeIdentifier(value: string): string {
  const normalized = _normalizeText(value);
  if (!normalized) return "";

  const segments = normalized.split(/[$:.]/).filter(Boolean);
  const tail = segments.length > 0 ? segments[segments.length - 1] : normalized;

  let label = tail.replace(/^ctl\d+_?/i, "");
  label = label.replace(
    /^(txt|tb|ddl|drp|cmb|sel|rdo|rb|chk|cb|opt|fld|field|input|question|qstn)[_-]*/i,
    "",
  );
  label = label.replace(/[_-]+/g, " ");
  label = label.replace(/([a-z])([A-Z])/g, "$1 $2");
  label = _normalizeText(label);

  if (!label) {
    label = _normalizeText(
      tail.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"),
    );
  }
  if (!label) return "";
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function _pickBestLabel(element: RawElement, fallbackIndex: number): string {
  const candidates: string[] = [];
  for (const key of [
    "label",
    "surrounding_text",
    "aria_label",
    "placeholder",
  ]) {
    const value = element[key];
    if (typeof value === "string") {
      candidates.push(value);
    }
  }

  const name = typeof element.name === "string" ? element.name : "";
  const id = typeof element.id === "string" ? element.id : "";
  if (name) {
    candidates.push(_humanizeIdentifier(name));
  }
  if (id) {
    candidates.push(_humanizeIdentifier(id));
  }

  for (const candidate of candidates) {
    const cleaned = _stripRequiredPrefix(candidate);
    if (!cleaned || _isGenericLabel(cleaned)) continue;
    return cleaned;
  }

  return `Field ${fallbackIndex + 1}`;
}

function _isFrameworkInternalElement(element: RawElement): boolean {
  const type = _normalizeText(String(element.type ?? "")).toLowerCase();
  if (type === "hidden") return true;

  const name = _normalizeText(String(element.name ?? ""));
  const id = _normalizeText(String(element.id ?? ""));
  const combined = `${name} ${id}`;
  if (!combined.trim()) return false;

  return INTERNAL_FIELD_NAME_RE.test(combined);
}

function _filterRawElements(rawElements: RawElement[]): RawElement[] {
  return rawElements.filter((element) => {
    const tag = _normalizeText(String(element.tag ?? "")).toLowerCase();
    const type = _normalizeText(String(element.type ?? "")).toLowerCase();
    const role = _normalizeText(String(element.role ?? "")).toLowerCase();

    if (
      tag === "input" &&
      ["submit", "reset", "button", "image", "hidden"].includes(type)
    ) {
      return false;
    }
    if (_isFrameworkInternalElement(element)) return false;

    const isControlTag =
      tag === "input" || tag === "select" || tag === "textarea";
    const hasInteractiveRole = [
      "listbox",
      "radiogroup",
      "combobox",
      "spinbutton",
      "group",
      "checkbox",
    ].includes(role);
    if (!isControlTag && !hasInteractiveRole) return false;

    const hasAnySignal = [
      "name",
      "id",
      "label",
      "aria_label",
      "placeholder",
      "surrounding_text",
    ].some((key) => _normalizeText(String(element[key] ?? "")).length > 0);

    return hasAnySignal || type.length > 0;
  });
}

function _inferFieldType(element: RawElement): FieldType {
  const tag = _normalizeText(String(element.tag ?? "")).toLowerCase();
  const type = _normalizeText(String(element.type ?? "")).toLowerCase();
  const role = _normalizeText(String(element.role ?? "")).toLowerCase();

  if (tag === "textarea") return "long_text";
  if (
    tag === "select" ||
    type === "select" ||
    role === "listbox" ||
    role === "combobox"
  ) {
    return "dropdown";
  }
  if (type === "radio" || role === "radiogroup") return "radio";
  if (type === "checkbox" || role === "checkbox") return "checkbox";
  if (type === "date") return "date";
  if (type === "time") return "time";
  return "short_text";
}

function _safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function _extractFromFrame(frame: Frame): Promise<{
  elements: RawElement[];
  title: string;
  heading: string;
}> {
  const raw = await frame.evaluate(`(${DOM_EXTRACTION_JS})()`);
  if (typeof raw !== "object" || raw === null) {
    return { elements: [], title: "", heading: "" };
  }

  const rec = raw as Record<string, unknown>;
  const sourceElements = Array.isArray(rec.elements)
    ? (rec.elements as unknown[])
    : [];

  const frameUrl = _safeString(frame.url());
  const frameName = _safeString(frame.name());
  const elements: RawElement[] = sourceElements
    .filter((item): item is RawElement => typeof item === "object" && item !== null)
    .map((item) => ({
      ...item,
      frame_url: frameUrl,
      frame_name: frameName,
      frame_is_main: frame === frame.page().mainFrame(),
    }));

  return {
    elements,
    title: _safeString(rec.title),
    heading: _safeString(rec.heading),
  };
}

async function _extractDomFromPageFrames(
  page: Page,
): Promise<RawExtractionResult> {
  const frames = page.frames();
  const frameErrors: string[] = [];
  const allElements: RawElement[] = [];

  let title = "";
  let heading = "";
  let nextIndex = 0;

  for (const frame of frames) {
    try {
      const extracted = await _extractFromFrame(frame);
      if (!heading && extracted.heading) {
        heading = extracted.heading;
      }
      if (!title && extracted.title) {
        title = extracted.title;
      }
      for (const element of extracted.elements) {
        allElements.push({
          ...element,
          index: nextIndex,
        });
        nextIndex += 1;
      }
    } catch (e) {
      frameErrors.push(
        `frame='${_safeString(frame.url()) || "<unknown>"}' error='${String(e)}'`,
      );
    }
  }

  return {
    elements: allElements,
    title,
    heading,
    frame_count: frames.length,
    frame_errors: frameErrors,
  };
}

function _fieldDedupKey(field: FormField): string {
  const fieldId = _normalizeText(field.field_id || "").toLowerCase();
  if (fieldId) {
    return `${field.page_index}\x00id\x00${fieldId}`;
  }

  const label = (field.label || "").replace(/\s+/g, " ").trim().toLowerCase();
  const opts = field.options
    ? field.options
        .map((o) => o.toLowerCase().trim())
        .sort()
        .join("|")
    : "";
  return `${field.page_index}\x00${label}\x00${field.field_type}\x00${opts}`;
}

function _makeFieldId(
  element: RawElement,
  index: number,
  pageIndex: number,
): string {
  const name = typeof element.name === "string" ? element.name : "";
  const id = typeof element.id === "string" ? element.id : "";
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

function _heuristicClassifyFields(
  rawElements: RawElement[],
): ClassifiedField[] {
  return rawElements.map((element, idx) => {
    const fallbackIndex =
      typeof element.index === "number" ? element.index : idx;

    return {
      element_index: fallbackIndex,
      label: _pickBestLabel(element, idx),
      field_type: _inferFieldType(element),
      required: Boolean(element.required),
      options: _normalizeOptions(element.options),
    };
  });
}

async function _classifyFieldsBatchWithAI(
  client: Anthropic,
  rawElements: RawElement[],
): Promise<ClassifiedField[]> {
  if (rawElements.length === 0) return [];

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
    options: _normalizeOptions(el.options).slice(0, 50),
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

async function _classifyFieldsWithAI(
  rawElements: RawElement[],
): Promise<ClassifiedField[]> {
  if (!settings.anthropic_api_key) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }
  if (rawElements.length === 0) return [];

  const client = new Anthropic({ apiKey: settings.anthropic_api_key });
  const classified: ClassifiedField[] = [];

  for (
    let start = 0;
    start < rawElements.length;
    start += CLASSIFY_BATCH_SIZE
  ) {
    const batch = rawElements.slice(start, start + CLASSIFY_BATCH_SIZE);
    const batchResult = await _classifyFieldsBatchWithAI(client, batch);
    classified.push(...batchResult);
  }

  return classified;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function scrapeGenericForm(url: string): Promise<FormSchema> {
  const scrapeWarnings: string[] = [];

  const browser = await chromium.launch({
    headless: settings.generic_playwright_headless,
  });
  const page = await browser.newPage({
    userAgent: GENERIC_BROWSER_USER_AGENT,
  });

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
      // Extract DOM elements from the main document and all iframes.
      let raw: RawExtractionResult;
      try {
        raw = await _extractDomFromPageFrames(page);
      } catch (e) {
        scrapeWarnings.push(
          `DOM extraction failed on page ${pageIndex + 1}: ${e}`,
        );
        break;
      }

      let rawElements: RawElement[] = raw.elements;
      if (rawElements.length === 0) {
        // Some legacy forms populate iframe inputs a bit later.
        await page.waitForTimeout(1500);
        try {
          const retryRaw = await _extractDomFromPageFrames(page);
          if (retryRaw.elements.length > 0) {
            raw = retryRaw;
            rawElements = retryRaw.elements;
          } else {
            raw.frame_errors.push(...retryRaw.frame_errors);
          }
        } catch {
          // keep original extraction result
        }
      }

      if (raw.frame_errors.length > 0) {
        scrapeWarnings.push(
          `Frame extraction issues on page ${pageIndex + 1}: ${raw.frame_errors.slice(0, 3).join(" | ")}`,
        );
      }

      const filteredElements = _filterRawElements(rawElements);

      const elementByIndex = new Map<number, RawElement>();
      for (const element of filteredElements) {
        const idx = typeof element.index === "number" ? element.index : -1;
        if (idx >= 0) {
          elementByIndex.set(idx, element);
        }
      }

      if (pageIndex === 0) {
        pageTitle = raw.heading || raw.title || "Untitled Form";
      }

      if (rawElements.length === 0 && raw.frame_count > 1) {
        scrapeWarnings.push(
          `No form controls found across ${raw.frame_count} frames on page ${pageIndex + 1}.`,
        );
      }

      if (rawElements.length > 0 && filteredElements.length === 0) {
        scrapeWarnings.push(
          `Extracted ${rawElements.length} raw DOM elements on page ${pageIndex + 1} but all were filtered as non-user/internal controls.`,
        );
      }

      if (filteredElements.length > 0) {
        let classified: ClassifiedField[] = [];
        let usedHeuristicFallback = false;
        try {
          classified = await _classifyFieldsWithAI(filteredElements);
        } catch (e) {
          scrapeWarnings.push(`AI classification failed: ${e}`);
        }

        if (classified.length === 0) {
          scrapeWarnings.push(
            `Extracted ${filteredElements.length} candidate DOM elements on page ${pageIndex + 1} but AI classified none as user-facing fields.`,
          );
          classified = _heuristicClassifyFields(filteredElements);
          usedHeuristicFallback = classified.length > 0;
        }

        if (usedHeuristicFallback) {
          scrapeWarnings.push(
            `Used deterministic fallback classification for page ${pageIndex + 1} after AI produced no usable field set.`,
          );
        }

        for (const cf of classified) {
          const elIdx =
            typeof cf.element_index === "number" ? cf.element_index : -1;
          const original = elementByIndex.get(elIdx) ?? {};

          const rawFieldType = _normalizeText(
            typeof cf.field_type === "string" ? cf.field_type : "",
          ).toLowerCase();
          const fieldType: FieldType = VALID_FIELD_TYPES.has(rawFieldType)
            ? (rawFieldType as FieldType)
            : _inferFieldType(original);

          const aiLabel = _stripRequiredPrefix(
            _normalizeText(typeof cf.label === "string" ? cf.label : ""),
          );
          const label =
            aiLabel && !_isGenericLabel(aiLabel)
              ? aiLabel
              : _pickBestLabel(original, allFields.length);

          const optionsFromAI = _normalizeOptions(cf.options);
          const options =
            optionsFromAI.length > 0
              ? optionsFromAI
              : _normalizeOptions(original.options);

          const field: FormField = {
            field_id: _makeFieldId(original, elIdx, pageIndex),
            label,
            field_type: fieldType,
            required:
              typeof cf.required === "boolean"
                ? cf.required
                : Boolean(original.required),
            options,
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
