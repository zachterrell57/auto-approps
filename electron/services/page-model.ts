// ---------------------------------------------------------------------------
// page-model.ts — Page snapshot and navigation element extraction
//
// Port of backend/src/auto_approps/page_model.py.
// Evaluates JavaScript in a Playwright browser context to capture the current
// state of a Microsoft Forms page: visible questions, navigation controls,
// page indicators, and a DOM text excerpt.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";

import { type Page } from "playwright";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NAV_SELECTOR = "button, a, [role='button'], [tabindex='0']";
const DOM_EXCERPT_MAX_CHARS = 8000;
const OUTER_HTML_MAX_CHARS = 480;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface NavigationElement {
  index: number;
  dom_index: number;
  tag: string;
  role: string;
  text: string;
  aria_label: string;
  title_attr: string;
  data_automation_id: string;
  disabled: boolean;
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  outer_html: string;
}

export interface PageSnapshot {
  page_indicator: string;
  questions: string[];
  navigation: NavigationElement[];
  signature: string;
  dom_excerpt: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function _buildSignature(
  pageIndicator: string,
  questions: string[],
  navigation: NavigationElement[],
): string {
  const navTokens = navigation
    .filter((item) => item.visible && !item.disabled)
    .map((item) =>
      _normalizeText(
        `${item.text}|${item.aria_label}|${item.title_attr}|${item.data_automation_id}`,
      ),
    );

  const payload = [
    _normalizeText(pageIndicator),
    ...questions.map((q) => _normalizeText(q)),
    ...navTokens,
  ].join("|");

  return createHash("sha1").update(payload, "utf-8").digest("hex");
}

// ---------------------------------------------------------------------------
// Raw result shape returned by the in-browser evaluate call
// ---------------------------------------------------------------------------

interface RawPageData {
  page_indicator: string;
  questions: unknown[];
  navigation: unknown[];
  dom_excerpt: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a JavaScript payload in the browser to capture the current page
 * state, then process the raw results into typed objects.
 */
export async function getPageSnapshot(page: Page): Promise<PageSnapshot> {
  const raw: RawPageData = await page.evaluate(
    () => {
      const normalize = (value: any) =>
        (value || "").replace(/\s+/g, " ").trim();
      const isVisible = (el: any) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden")
          return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const getText = (el: any) =>
        normalize(el?.innerText || el?.textContent || "");

      const questionContainers = Array.from(
        document.querySelectorAll(
          '[data-automation-id="questionItem"], .office-form-question-element, [class*="QuestionContainer"]',
        ),
      );
      const questions: string[] = [];
      for (const container of questionContainers) {
        const titleEl = container.querySelector(
          '[data-automation-id="questionTitle"], .office-form-question-title, [class*="QuestionTitle"]',
        );
        const text = getText(titleEl || container);
        if (text && !questions.includes(text)) questions.push(text);
      }

      let pageIndicator = "";
      const indicatorNodes = Array.from(
        document.querySelectorAll(
          '[data-automation-id*="page"], [class*="Progress"], [class*="Step"], [role="progressbar"]',
        ),
      );
      for (const node of indicatorNodes) {
        const text = getText(node);
        if (/page\s*\d+\s*(of|\/)\s*\d+/i.test(text)) {
          pageIndicator = text;
          break;
        }
      }
      if (!pageIndicator) {
        const bodyText = normalize(document.body?.innerText || "");
        const match = bodyText.match(/page\s*\d+\s*(?:of|\/)\s*\d+/i);
        if (match) pageIndicator = match[0];
      }

      const navNodes = Array.from(
        document.querySelectorAll(
          "button, a, [role='button'], [tabindex='0']",
        ),
      );
      const navigation: any[] = [];
      navNodes.forEach((el: any, domIndex: number) => {
        const text = getText(el);
        const ariaLabel = normalize(el.getAttribute("aria-label") || "");
        const titleAttr = normalize(el.getAttribute("title") || "");
        const automationId = normalize(
          el.getAttribute("data-automation-id") || "",
        );
        const role = normalize(el.getAttribute("role") || "");
        const outerHtml = normalize((el.outerHTML || "").slice(0, 480));
        const visible = isVisible(el);
        const rect = el.getBoundingClientRect();
        navigation.push({
          dom_index: domIndex,
          tag: normalize(el.tagName || "").toLowerCase(),
          role,
          text,
          aria_label: ariaLabel,
          title_attr: titleAttr,
          data_automation_id: automationId,
          disabled:
            el.hasAttribute("disabled") ||
            el.getAttribute("aria-disabled") === "true",
          visible,
          x: rect.x || 0,
          y: rect.y || 0,
          width: rect.width || 0,
          height: rect.height || 0,
          outer_html: outerHtml,
        });
      });

      const domExcerpt = normalize(document.body?.innerText || "").slice(
        0,
        8000,
      );

      return {
        page_indicator: pageIndicator,
        questions,
        navigation,
        dom_excerpt: domExcerpt,
      };
    },
  );

  // ---- Process raw results into typed objects ----

  const questions: string[] = (raw.questions ?? [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => _normalizeText(item))
    .filter((item) => item.length > 0);

  const navigation: NavigationElement[] = [];
  const rawNav = raw.navigation ?? [];
  for (let idx = 0; idx < rawNav.length; idx++) {
    const item = rawNav[idx];
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    navigation.push({
      index: idx,
      dom_index: Number(rec.dom_index ?? idx),
      tag: _normalizeText(String(rec.tag ?? "")).toLowerCase(),
      role: _normalizeText(String(rec.role ?? "")).toLowerCase(),
      text: _normalizeText(String(rec.text ?? "")),
      aria_label: _normalizeText(String(rec.aria_label ?? "")),
      title_attr: _normalizeText(String(rec.title_attr ?? "")),
      data_automation_id: _normalizeText(
        String(rec.data_automation_id ?? ""),
      ).toLowerCase(),
      disabled: Boolean(rec.disabled ?? false),
      visible: Boolean(rec.visible ?? false),
      x: Number(rec.x ?? 0),
      y: Number(rec.y ?? 0),
      width: Number(rec.width ?? 0),
      height: Number(rec.height ?? 0),
      outer_html: _normalizeText(String(rec.outer_html ?? "")).slice(
        0,
        OUTER_HTML_MAX_CHARS,
      ),
    });
  }

  const pageIndicator = _normalizeText(String(raw.page_indicator ?? ""));
  const domExcerpt = _normalizeText(String(raw.dom_excerpt ?? "")).slice(
    0,
    DOM_EXCERPT_MAX_CHARS,
  );

  return {
    page_indicator: pageIndicator,
    questions,
    navigation,
    signature: _buildSignature(pageIndicator, questions, navigation),
    dom_excerpt: domExcerpt,
  };
}

/**
 * Click a navigation element by its DOM index (the index among all elements
 * matching NAV_SELECTOR on the page).
 *
 * Returns `true` if the element was found and clicked, `false` otherwise.
 */
export async function clickNavigationByDomIndex(
  page: Page,
  domIndex: number,
): Promise<boolean> {
  const locator = page.locator(NAV_SELECTOR);
  if ((await locator.count()) <= domIndex) {
    return false;
  }
  const target = locator.nth(domIndex);
  await target.click();
  return true;
}
