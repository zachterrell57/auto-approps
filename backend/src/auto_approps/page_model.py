from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from playwright.async_api import Page


_NAV_SELECTOR = "button, a, [role='button'], [tabindex='0']"
_DOM_EXCERPT_MAX_CHARS = 8000
_OUTER_HTML_MAX_CHARS = 480


@dataclass(frozen=True)
class NavigationElement:
    index: int
    dom_index: int
    tag: str
    role: str
    text: str
    aria_label: str
    title_attr: str
    data_automation_id: str
    disabled: bool
    visible: bool
    x: float
    y: float
    width: float
    height: float
    outer_html: str = ""


@dataclass(frozen=True)
class PageSnapshot:
    page_indicator: str
    questions: list[str]
    navigation: list[NavigationElement]
    signature: str
    dom_excerpt: str = ""


def _normalize_text(value: str) -> str:
    value = re.sub(r"\s+", " ", value).strip()
    return value


def _build_signature(
    page_indicator: str,
    questions: list[str],
    navigation: list[NavigationElement],
) -> str:
    nav_tokens = [
        _normalize_text(
            f"{item.text}|{item.aria_label}|{item.title_attr}|{item.data_automation_id}"
        )
        for item in navigation
        if item.visible and not item.disabled
    ]
    payload = "|".join(
        [_normalize_text(page_indicator)]
        + [_normalize_text(q) for q in questions]
        + nav_tokens
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


async def get_page_snapshot(page: Page) -> PageSnapshot:
    raw = await page.evaluate(
        """
        () => {
          const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
          const isVisible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          };

          const getText = (el) => normalize(el?.innerText || el?.textContent || '');

          const questionContainers = Array.from(
            document.querySelectorAll('[data-automation-id="questionItem"], .office-form-question-element, [class*="QuestionContainer"]')
          );
          const questions = [];
          for (const container of questionContainers) {
            const titleEl = container.querySelector('[data-automation-id="questionTitle"], .office-form-question-title, [class*="QuestionTitle"]');
            const text = getText(titleEl || container);
            if (text && !questions.includes(text)) questions.push(text);
          }

          let pageIndicator = '';
          const indicatorNodes = Array.from(
            document.querySelectorAll('[data-automation-id*="page"], [class*="Progress"], [class*="Step"], [role="progressbar"]')
          );
          for (const node of indicatorNodes) {
            const text = getText(node);
            if (/page\s*\d+\s*(of|\/)\s*\d+/i.test(text)) {
              pageIndicator = text;
              break;
            }
          }
          if (!pageIndicator) {
            const bodyText = normalize(document.body?.innerText || '');
            const match = bodyText.match(/page\s*\d+\s*(?:of|\/)\s*\d+/i);
            if (match) pageIndicator = match[0];
          }

          const navNodes = Array.from(document.querySelectorAll("button, a, [role='button'], [tabindex='0']"));
          const navigation = [];
          navNodes.forEach((el, domIndex) => {
            const text = getText(el);
            const ariaLabel = normalize(el.getAttribute('aria-label') || '');
            const titleAttr = normalize(el.getAttribute('title') || '');
            const automationId = normalize(el.getAttribute('data-automation-id') || '');
            const role = normalize(el.getAttribute('role') || '');
            const outerHtml = normalize((el.outerHTML || '').slice(0, 480));
            const visible = isVisible(el);
            const rect = el.getBoundingClientRect();
            navigation.push({
              dom_index: domIndex,
              tag: normalize(el.tagName || '').toLowerCase(),
              role,
              text,
              aria_label: ariaLabel,
              title_attr: titleAttr,
              data_automation_id: automationId,
              disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
              visible,
              x: rect.x || 0,
              y: rect.y || 0,
              width: rect.width || 0,
              height: rect.height || 0,
              outer_html: outerHtml,
            });
          });

          const domExcerpt = normalize(document.body?.innerText || '').slice(0, 8000);

          return {
            page_indicator: pageIndicator,
            questions,
            navigation,
            dom_excerpt: domExcerpt,
          };
        }
        """
    )

    questions = [
        _normalize_text(item)
        for item in raw.get("questions", [])
        if isinstance(item, str) and _normalize_text(item)
    ]

    navigation: list[NavigationElement] = []
    for idx, item in enumerate(raw.get("navigation", [])):
        if not isinstance(item, dict):
            continue
        navigation.append(
            NavigationElement(
                index=idx,
                dom_index=int(item.get("dom_index", idx)),
                tag=_normalize_text(str(item.get("tag", ""))).lower(),
                role=_normalize_text(str(item.get("role", ""))).lower(),
                text=_normalize_text(str(item.get("text", ""))),
                aria_label=_normalize_text(str(item.get("aria_label", ""))),
                title_attr=_normalize_text(str(item.get("title_attr", ""))),
                data_automation_id=_normalize_text(str(item.get("data_automation_id", ""))).lower(),
                disabled=bool(item.get("disabled", False)),
                visible=bool(item.get("visible", False)),
                x=float(item.get("x", 0.0)),
                y=float(item.get("y", 0.0)),
                width=float(item.get("width", 0.0)),
                height=float(item.get("height", 0.0)),
                outer_html=_normalize_text(str(item.get("outer_html", "")))[:_OUTER_HTML_MAX_CHARS],
            )
        )

    page_indicator = _normalize_text(str(raw.get("page_indicator", "")))
    dom_excerpt = _normalize_text(str(raw.get("dom_excerpt", "")))[:_DOM_EXCERPT_MAX_CHARS]

    return PageSnapshot(
        page_indicator=page_indicator,
        questions=questions,
        navigation=navigation,
        signature=_build_signature(page_indicator, questions, navigation),
        dom_excerpt=dom_excerpt,
    )


async def click_navigation_by_dom_index(page: Page, dom_index: int) -> bool:
    locator = page.locator(_NAV_SELECTOR)
    if await locator.count() <= dom_index:
        return False
    target = locator.nth(dom_index)
    await target.click()
    return True
