// ---------------------------------------------------------------------------
// ms-form-scraper.ts — Microsoft Forms scraper via Playwright
//
// Port of backend/src/auto_approps/ms_form_scraper.py (484 lines).
// Launches a headless Chromium browser, navigates through multi-page
// Microsoft Forms, extracts question metadata (label, type, options,
// required), and returns a structured FormSchema.
// ---------------------------------------------------------------------------

import { chromium, type Locator, type Page } from "playwright";

import { settings } from "./config";
import type { FieldType, FormField, FormSchema } from "./models";
import {
  navigateToNextPage,
  newNavigationContext,
} from "./nav-engine";
import { getPageSnapshot } from "./page-model";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DISCOVERY_TEXT = "TEMP_DISCOVERY";
const DISCOVERY_TIME = "09:00";
const SINGLE_PATH_WARNING =
  "Captured one deterministic path through this Microsoft Form. " +
  "If the form branches on earlier answers, additional questions may exist.";
const UNLOCK_MAX_ROUNDS = 3;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scrape a Microsoft Form URL and return its schema.
 *
 * Launches a Playwright Chromium browser, navigates page by page using
 * AI-guided navigation, extracts questions from each page, and auto-fills
 * placeholder values when the Next button is locked behind required fields.
 */
export async function scrapeMsForm(url: string): Promise<FormSchema> {
  const browser = await chromium.launch({
    headless: settings.ms_playwright_headless,
  });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: "domcontentloaded" });

  try {
    if (_isLoginUrl(page.url())) {
      throw new Error(
        "This Microsoft Form requires login. " +
          "Please ensure the form is set to accept anonymous responses.",
      );
    }

    try {
      await page.waitForSelector(
        '[data-automation-id="questionItem"], ' +
          ".office-form-question-element, " +
          '[class*="QuestionContainer"]',
        { timeout: 15000 },
      );
    } catch {
      throw new Error(
        "Could not find form questions. The form may require login, " +
          "be expired, or the URL may be invalid.",
      );
    }

    const title = await _extractTitle(page);

    let pageIndex = 0;
    const allFields: FormField[] = [];
    const seenFields = new Set<string>();
    let snapshot = await getPageSnapshot(page);
    const navContext = newNavigationContext(url);
    const seenSignatures = new Set<string>();
    const placeholderPages = new Set<number>();
    const scrapeWarnings: string[] = [SINGLE_PATH_WARNING];

    while (pageIndex < navContext.max_pages) {
      if (seenSignatures.has(snapshot.signature)) {
        scrapeWarnings.push(
          "Detected repeated page structure while crawling. " +
            "Stopped to avoid an infinite loop.",
        );
        break;
      }
      seenSignatures.add(snapshot.signature);

      const fields = await _extractFields(page, pageIndex);
      for (const f of fields) {
        const key = _fieldDedupKey(f);
        if (!seenFields.has(key)) {
          seenFields.add(key);
          allFields.push(f);
        }
      }

      let navOutcome = await navigateToNextPage(
        page,
        navContext,
        snapshot,
      );
      if (navOutcome.moved) {
        if (_isLoginUrl(page.url())) {
          scrapeWarnings.push(
            "Navigation reached a Microsoft login page while discovering questions. " +
              "Stopped capture to avoid leaving the target form.",
          );
          break;
        }
        pageIndex += 1;
        snapshot = navOutcome.snapshot;
        continue;
      }

      if (navOutcome.should_stop) {
        if (_isTerminalNavigationReason(navOutcome.reason_code)) {
          break;
        }
        scrapeWarnings.push(
          _formatNavigationStopWarning(
            pageIndex,
            navOutcome.reason_code,
            navOutcome.reason_detail,
          ),
        );
        break;
      }

      // Attempt to unlock navigation by filling empty required fields
      let advanced = false;
      let terminal = false;
      for (let round = 0; round < UNLOCK_MAX_ROUNDS; round++) {
        const applied = await _fillEmptyControlsRound(page);
        if (applied > 0) {
          placeholderPages.add(pageIndex + 1);
        }

        const refreshed = await getPageSnapshot(page);
        navOutcome = await navigateToNextPage(
          page,
          navContext,
          refreshed,
        );
        if (navOutcome.moved) {
          if (_isLoginUrl(page.url())) {
            scrapeWarnings.push(
              "Navigation reached a Microsoft login page while discovering questions. " +
                "Stopped capture to avoid leaving the target form.",
            );
            terminal = true;
            break;
          }
          pageIndex += 1;
          snapshot = navOutcome.snapshot;
          advanced = true;
          break;
        }

        if (navOutcome.should_stop) {
          if (!_isTerminalNavigationReason(navOutcome.reason_code)) {
            scrapeWarnings.push(
              _formatNavigationStopWarning(
                pageIndex,
                navOutcome.reason_code,
                navOutcome.reason_detail,
              ),
            );
          }
          terminal = true;
          break;
        }

        if (applied === 0) {
          break;
        }
      }

      if (terminal) break;
      if (advanced) continue;

      scrapeWarnings.push(
        `Stopped on page ${pageIndex + 1} because Next remained blocked ` +
          `after ${UNLOCK_MAX_ROUNDS} unlock attempts. Results may be partial.`,
      );
      break;
    }

    const pageCount = pageIndex + 1;

    if (placeholderPages.size > 0) {
      const pages = Array.from(placeholderPages)
        .sort((a, b) => a - b)
        .join(", ");
      scrapeWarnings.push(
        "Temporary placeholder answers were entered on page(s) " +
          `${pages} to unlock navigation during discovery.`,
      );
    }

    return {
      title,
      description: "",
      fields: allFields,
      page_count: pageCount,
      url,
      provider: "microsoft",
      scrape_warnings: scrapeWarnings,
    };
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function _isLoginUrl(url: string): boolean {
  return (url || "").toLowerCase().includes("login.microsoftonline.com");
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function _normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Navigation classification helpers
// ---------------------------------------------------------------------------

function _fieldDedupKey(field: FormField): string {
  const label = _normalizeText(field.label).toLowerCase();
  const opts = field.options
    ? field.options
        .map((o) => o.toLowerCase().trim())
        .sort()
        .join("|")
    : "";
  const fieldId = _normalizeText(field.field_id).toLowerCase();
  return `${field.page_index}\x00${fieldId}\x00${label}\x00${field.field_type}\x00${opts}`;
}

function _isTerminalNavigationReason(reasonCode: string): boolean {
  return reasonCode === "no_forward_control";
}

function _formatNavigationStopWarning(
  pageIndex: number,
  reasonCode: string,
  reasonDetail: string,
): string {
  let detail = reasonDetail.trim();
  if (detail) {
    detail = `: ${detail}`;
  }
  return (
    `Stopped on page ${pageIndex + 1} because AI navigation failed ` +
    `(${reasonCode || "unknown"})${detail}. Results may be partial.`
  );
}

// ---------------------------------------------------------------------------
// Title extraction
// ---------------------------------------------------------------------------

async function _extractTitle(page: Page): Promise<string> {
  for (const selector of [
    '[data-automation-id="formTitle"]',
    ".office-form-title-content",
    '[class*="FormTitle"]',
    "h1",
  ]) {
    const el = page.locator(selector);
    if ((await el.count()) > 0) {
      const text = _normalizeText(await el.first().innerText());
      if (text) return text;
    }
  }
  return "Untitled Form";
}

// ---------------------------------------------------------------------------
// Field extraction
// ---------------------------------------------------------------------------

async function _extractFields(
  page: Page,
  pageIndex: number,
): Promise<FormField[]> {
  const fields: FormField[] = [];
  const containers = await _getQuestionContainers(page);
  const count = await containers.count();
  for (let i = 0; i < count; i++) {
    const container = containers.nth(i);
    try {
      if (!(await container.isVisible())) continue;
    } catch {
      // Best-effort visibility check; proceed if it fails.
    }
    const field = await _parseQuestion(container, i, pageIndex);
    if (field) {
      fields.push(field);
    }
  }
  return fields;
}

async function _getQuestionContainers(page: Page): Promise<Locator> {
  let containers = page.locator('[data-automation-id="questionItem"]');
  if ((await containers.count()) === 0) {
    containers = page.locator(".office-form-question-element");
  }
  if ((await containers.count()) === 0) {
    containers = page.locator('[class*="QuestionContainer"]');
  }
  return containers;
}

async function _fallbackLabelFromAria(
  container: Locator,
): Promise<string> {
  const selectors = [
    "input",
    "textarea",
    '[role="radio"]',
    '[role="checkbox"]',
    '[role="listbox"]',
    '[data-automation-id="dropdownButton"]',
  ];
  for (const selector of selectors) {
    const elements = container.locator(selector);
    if ((await elements.count()) === 0) continue;
    const aria = _normalizeText(
      await elements.first().getAttribute("aria-label"),
    );
    if (aria) return aria;
  }
  return "";
}

async function _parseQuestion(
  container: Locator,
  index: number,
  pageIndex: number,
): Promise<FormField | null> {
  let label = "";
  let rawLabel = "";
  for (const selector of [
    '[data-automation-id="questionTitle"]',
    ".office-form-question-title",
    '[class*="QuestionTitle"]',
  ]) {
    const el = container.locator(selector);
    if ((await el.count()) > 0) {
      rawLabel = _normalizeText(await el.first().innerText());
      label = rawLabel.replace(/\s*\*$/, "");
      break;
    }
  }

  if (!label) {
    label = await _fallbackLabelFromAria(container);
  }
  if (!label) {
    label = `Question ${pageIndex + 1}.${index + 1}`;
  }

  const fieldId = await _extractFieldId(container, index, pageIndex);

  let required = !!rawLabel && rawLabel.endsWith("*");
  const requiredEl = container.locator(
    '[aria-required="true"], [required]',
  );
  if ((await requiredEl.count()) > 0) {
    required = true;
  } else {
    const reqSpan = container.locator(
      '[data-automation-id="questionRequiredMark"], ' +
        ".office-form-question-required, " +
        '[class*="Required"], ' +
        '[class*="required"]',
    );
    if ((await reqSpan.count()) > 0) {
      required = true;
    } else if (rawLabel && /\brequired\b/i.test(rawLabel)) {
      required = true;
    }
  }

  const [fieldType, options] = await _detectFieldType(container);

  return {
    field_id: fieldId,
    label,
    field_type: fieldType,
    required,
    options,
    page_index: pageIndex,
  };
}

// ---------------------------------------------------------------------------
// Field ID extraction
// ---------------------------------------------------------------------------

async function _extractFieldId(
  container: Locator,
  index: number,
  pageIndex: number,
): Promise<string> {
  for (const selector of [
    "input",
    "textarea",
    '[role="radiogroup"]',
    '[role="listbox"]',
  ]) {
    const el = container.locator(selector);
    if ((await el.count()) === 0) continue;
    const labelledby = await el.first().getAttribute("aria-labelledby");
    if (labelledby) {
      for (const part of labelledby.split(/\s+/)) {
        if (part.includes("QuestionId") || part.startsWith("r")) {
          return part;
        }
      }
      return labelledby.split(/\s+/)[0];
    }
  }

  const autoId = await container.getAttribute("data-automation-id");
  if (autoId && autoId !== "questionItem") {
    return autoId;
  }

  return `ms_field_${pageIndex}_${index}`;
}

// ---------------------------------------------------------------------------
// Field type detection
// ---------------------------------------------------------------------------

async function _detectFieldType(
  container: Locator,
): Promise<[FieldType, string[]]> {
  let options: string[] = [];

  // Radio group
  const radioGroup = container.locator('[role="radiogroup"]');
  if ((await radioGroup.count()) > 0) {
    options = await _extractOptions(container, '[role="radio"]');
    return ["radio", options];
  }

  // Checkbox group
  let checkboxGroup = container.locator(
    '[role="group"]:has([role="checkbox"])',
  );
  if ((await checkboxGroup.count()) === 0) {
    checkboxGroup = container.locator('[role="checkbox"]');
  }
  if ((await checkboxGroup.count()) > 0) {
    options = await _extractOptions(container, '[role="checkbox"]');
    return ["checkbox", options];
  }

  // Dropdown / listbox
  const listbox = container.locator(
    '[role="listbox"], [data-automation-id="dropdownButton"]',
  );
  if ((await listbox.count()) > 0) {
    return ["dropdown", options];
  }

  // Rating / linear scale
  const rating = container.locator(
    '[data-automation-id="ratingItem"], [class*="Rating"]',
  );
  if ((await rating.count()) > 0) {
    return ["linear_scale", options];
  }

  // Date input
  const dateInput = container.locator(
    'input[type="date"], [data-automation-id="dateInput"]',
  );
  if ((await dateInput.count()) > 0) {
    return ["date", options];
  }

  // Time input
  const timeInput = container.locator(
    'input[type="time"], [data-automation-id="timeInput"]',
  );
  if ((await timeInput.count()) > 0) {
    return ["time", options];
  }

  // Textarea / long text
  const textarea = container.locator("textarea");
  if ((await textarea.count()) > 0) {
    return ["long_text", options];
  }

  return ["short_text", options];
}

// ---------------------------------------------------------------------------
// Option extraction
// ---------------------------------------------------------------------------

async function _extractOptions(
  container: Locator,
  itemSelector: string,
): Promise<string[]> {
  const options: string[] = [];
  const items = container.locator(itemSelector);
  const count = await items.count();
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    const ariaLabel = _normalizeText(
      await item.getAttribute("aria-label"),
    );
    if (ariaLabel) {
      options.push(ariaLabel);
      continue;
    }
    const spans = item.locator("span");
    if ((await spans.count()) > 0) {
      const text = _normalizeText(await spans.first().innerText());
      if (text) {
        options.push(text);
      }
    }
  }
  return options;
}

// ---------------------------------------------------------------------------
// Placeholder fill helpers (unlock navigation by filling required fields)
// ---------------------------------------------------------------------------

async function _fillEmptyControlsRound(page: Page): Promise<number> {
  const todayIso = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  let actions = 0;
  const containers = await _getQuestionContainers(page);
  const count = await containers.count();

  for (let i = 0; i < count; i++) {
    const container = containers.nth(i);
    try {
      actions += await _fillEmptyInputs(
        container,
        "textarea",
        DISCOVERY_TEXT,
      );
      actions += await _fillEmptyInputs(
        container,
        'input[type="date"]',
        todayIso,
      );
      actions += await _fillEmptyInputs(
        container,
        'input[type="time"]',
        DISCOVERY_TIME,
      );
      actions += await _fillEmptyInputs(
        container,
        "input:not([type='hidden']):not([type='date']):not([type='time']):not([type='radio']):not([type='checkbox'])",
        DISCOVERY_TEXT,
      );
      actions += await _selectOneRadio(container);
      actions += await _selectOneCheckbox(container);
      actions += await _selectOneDropdownOption(page, container);
    } catch {
      continue;
    }
  }

  return actions;
}

async function _fillEmptyInputs(
  container: Locator,
  selector: string,
  value: string,
): Promise<number> {
  let filled = 0;
  const fields = container.locator(selector);
  const count = await fields.count();
  for (let i = 0; i < count; i++) {
    const field = fields.nth(i);
    try {
      if (!(await field.isVisible())) continue;
      const existing = _normalizeText(await field.inputValue());
      if (existing) continue;
      await field.click();
      await field.fill(value);
      filled += 1;
    } catch {
      continue;
    }
  }
  return filled;
}

async function _hasCheckedRoleOption(
  container: Locator,
  selector: string,
): Promise<boolean> {
  const options = container.locator(selector);
  const count = await options.count();
  for (let i = 0; i < count; i++) {
    const option = options.nth(i);
    try {
      if (!(await option.isVisible())) continue;
      if ((await option.getAttribute("aria-checked")) === "true") {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

async function _clickFirstVisibleRoleOption(
  container: Locator,
  selector: string,
): Promise<number> {
  const options = container.locator(selector);
  const count = await options.count();
  for (let i = 0; i < count; i++) {
    const option = options.nth(i);
    try {
      if (!(await option.isVisible())) continue;
      await option.click();
      return 1;
    } catch {
      continue;
    }
  }
  return 0;
}

async function _selectOneRadio(container: Locator): Promise<number> {
  if (await _hasCheckedRoleOption(container, '[role="radio"]')) {
    return 0;
  }
  return _clickFirstVisibleRoleOption(container, '[role="radio"]');
}

async function _selectOneCheckbox(container: Locator): Promise<number> {
  if (await _hasCheckedRoleOption(container, '[role="checkbox"]')) {
    return 0;
  }
  return _clickFirstVisibleRoleOption(container, '[role="checkbox"]');
}

async function _selectOneDropdownOption(
  page: Page,
  container: Locator,
): Promise<number> {
  const selected = container.locator(
    '[role="option"][aria-selected="true"]',
  );
  if ((await selected.count()) > 0) {
    return 0;
  }

  const dropdowns = container.locator(
    '[role="listbox"], [data-automation-id="dropdownButton"]',
  );
  const count = await dropdowns.count();
  for (let i = 0; i < count; i++) {
    const dropdown = dropdowns.nth(i);
    try {
      if (!(await dropdown.isVisible())) continue;
      await dropdown.click();
      await page.waitForTimeout(150);
      const options = page.locator('[role="option"]');
      const optionCount = await options.count();
      for (let j = 0; j < optionCount; j++) {
        const option = options.nth(j);
        if (!(await option.isVisible())) continue;
        if ((await option.getAttribute("aria-selected")) === "true") {
          continue;
        }
        await option.click();
        return 1;
      }
    } catch {
      continue;
    }
  }
  return 0;
}
