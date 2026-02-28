from __future__ import annotations

import re
from datetime import date

from playwright.async_api import Locator, Page, async_playwright

from .config import settings
from .models import FieldType, FormField, FormSchema
from .nav_engine import navigate_to_next_page, new_navigation_context
from .page_model import get_page_snapshot

_DISCOVERY_TEXT = "TEMP_DISCOVERY"
_DISCOVERY_TIME = "09:00"
_SINGLE_PATH_WARNING = (
    "Captured one deterministic path through this Microsoft Form. "
    "If the form branches on earlier answers, additional questions may exist."
)
_UNLOCK_MAX_ROUNDS = 3


async def scrape_ms_form(url: str) -> FormSchema:
    """Scrape a Microsoft Form URL and return its schema."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=settings.ms_playwright_headless)
        page = await browser.new_page()

        await page.goto(url, wait_until="domcontentloaded")

        if _is_login_url(page.url):
            await browser.close()
            raise ValueError(
                "This Microsoft Form requires login. "
                "Please ensure the form is set to accept anonymous responses."
            )

        try:
            await page.wait_for_selector(
                '[data-automation-id="questionItem"], '
                '.office-form-question-element, '
                '[class*="QuestionContainer"]',
                timeout=15000,
            )
        except Exception:
            await browser.close()
            raise ValueError(
                "Could not find form questions. The form may require login, "
                "be expired, or the URL may be invalid."
            )

        title = await _extract_title(page)

        page_index = 0
        all_fields: list[FormField] = []
        snapshot = await get_page_snapshot(page)
        nav_context = new_navigation_context(url)
        seen_signatures: set[str] = set()
        placeholder_pages: set[int] = set()
        scrape_warnings = [_SINGLE_PATH_WARNING]

        while page_index < nav_context.max_pages:
            if snapshot.signature in seen_signatures:
                scrape_warnings.append(
                    "Detected repeated page structure while crawling. "
                    "Stopped to avoid an infinite loop."
                )
                break
            seen_signatures.add(snapshot.signature)

            fields = await _extract_fields(page, page_index)
            all_fields.extend(fields)

            nav_outcome = await navigate_to_next_page(page, nav_context, snapshot)
            if nav_outcome.moved:
                if _is_login_url(page.url):
                    scrape_warnings.append(
                        "Navigation reached a Microsoft login page while discovering questions. "
                        "Stopped capture to avoid leaving the target form."
                    )
                    break
                page_index += 1
                snapshot = nav_outcome.snapshot
                continue

            if nav_outcome.should_stop:
                if _is_terminal_navigation_reason(nav_outcome.reason_code):
                    break
                scrape_warnings.append(
                    _format_navigation_stop_warning(
                        page_index,
                        nav_outcome.reason_code,
                        nav_outcome.reason_detail,
                    )
                )
                break

            advanced = False
            terminal = False
            for _ in range(_UNLOCK_MAX_ROUNDS):
                applied = await _fill_empty_controls_round(page)
                if applied > 0:
                    placeholder_pages.add(page_index + 1)

                refreshed = await get_page_snapshot(page)
                nav_outcome = await navigate_to_next_page(page, nav_context, refreshed)
                if nav_outcome.moved:
                    if _is_login_url(page.url):
                        scrape_warnings.append(
                            "Navigation reached a Microsoft login page while discovering questions. "
                            "Stopped capture to avoid leaving the target form."
                        )
                        terminal = True
                        break
                    page_index += 1
                    snapshot = nav_outcome.snapshot
                    advanced = True
                    break

                if nav_outcome.should_stop:
                    if not _is_terminal_navigation_reason(nav_outcome.reason_code):
                        scrape_warnings.append(
                            _format_navigation_stop_warning(
                                page_index,
                                nav_outcome.reason_code,
                                nav_outcome.reason_detail,
                            )
                        )
                    terminal = True
                    break

                if applied == 0:
                    break

            if terminal:
                break
            if advanced:
                continue

            scrape_warnings.append(
                f"Stopped on page {page_index + 1} because Next remained blocked "
                f"after {_UNLOCK_MAX_ROUNDS} unlock attempts. Results may be partial."
            )
            break

        page_count = page_index + 1

        await browser.close()

        if placeholder_pages:
            pages = ", ".join(str(i) for i in sorted(placeholder_pages))
            scrape_warnings.append(
                "Temporary placeholder answers were entered on page(s) "
                f"{pages} to unlock navigation during discovery."
            )

        return FormSchema(
            title=title,
            description="",
            fields=all_fields,
            page_count=page_count,
            url=url,
            provider="microsoft",
            scrape_warnings=scrape_warnings,
        )


def _is_login_url(url: str) -> bool:
    return "login.microsoftonline.com" in (url or "").lower()


def _normalize_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", value).strip()


def _is_terminal_navigation_reason(reason_code: str) -> bool:
    return reason_code in {"no_forward_control"}


def _format_navigation_stop_warning(page_index: int, reason_code: str, reason_detail: str) -> str:
    detail = reason_detail.strip()
    if detail:
        detail = f": {detail}"
    return (
        f"Stopped on page {page_index + 1} because AI navigation failed "
        f"({reason_code or 'unknown'}){detail}. Results may be partial."
    )


async def _extract_title(page: Page) -> str:
    for selector in [
        '[data-automation-id="formTitle"]',
        ".office-form-title-content",
        '[class*="FormTitle"]',
        "h1",
    ]:
        el = page.locator(selector)
        if await el.count() > 0:
            text = _normalize_text(await el.first.inner_text())
            if text:
                return text
    return "Untitled Form"

async def _extract_fields(page: Page, page_index: int) -> list[FormField]:
    fields: list[FormField] = []
    containers = await _get_question_containers(page)
    count = await containers.count()
    for i in range(count):
        container = containers.nth(i)
        field = await _parse_question(container, i, page_index)
        if field:
            fields.append(field)
    return fields


async def _get_question_containers(page: Page) -> Locator:
    containers = page.locator('[data-automation-id="questionItem"]')
    if await containers.count() == 0:
        containers = page.locator(".office-form-question-element")
    if await containers.count() == 0:
        containers = page.locator('[class*="QuestionContainer"]')
    return containers


async def _fallback_label_from_aria(container: Locator) -> str:
    selectors = [
        "input",
        "textarea",
        '[role="radio"]',
        '[role="checkbox"]',
        '[role="listbox"]',
        '[data-automation-id="dropdownButton"]',
    ]
    for selector in selectors:
        elements = container.locator(selector)
        if await elements.count() == 0:
            continue
        aria = _normalize_text(await elements.first.get_attribute("aria-label"))
        if aria:
            return aria
    return ""


async def _parse_question(container: Locator, index: int, page_index: int) -> FormField | None:
    label = ""
    raw_label = ""
    for selector in [
        '[data-automation-id="questionTitle"]',
        ".office-form-question-title",
        '[class*="QuestionTitle"]',
    ]:
        el = container.locator(selector)
        if await el.count() > 0:
            raw_label = _normalize_text(await el.first.inner_text())
            label = raw_label.rstrip(" *")
            break

    if not label:
        label = await _fallback_label_from_aria(container)
    if not label:
        label = f"Question {page_index + 1}.{index + 1}"

    field_id = await _extract_field_id(container, index, page_index)

    required = bool(raw_label) and raw_label.endswith("*")
    required_el = container.locator('[aria-required="true"], [required]')
    if await required_el.count() > 0:
        required = True
    else:
        req_span = container.locator(
            '[data-automation-id="questionRequiredMark"], '
            '.office-form-question-required, '
            '[class*="Required"], '
            '[class*="required"]'
        )
        if await req_span.count() > 0:
            required = True
        elif raw_label and re.search(r"\brequired\b", raw_label, re.IGNORECASE):
            required = True

    field_type, options = await _detect_field_type(container)

    return FormField(
        field_id=field_id,
        label=label,
        field_type=field_type,
        required=required,
        options=options,
        page_index=page_index,
    )


async def _extract_field_id(container: Locator, index: int, page_index: int) -> str:
    for selector in ["input", "textarea", '[role="radiogroup"]', '[role="listbox"]']:
        el = container.locator(selector)
        if await el.count() == 0:
            continue
        labelledby = await el.first.get_attribute("aria-labelledby")
        if labelledby:
            for part in labelledby.split():
                if "QuestionId" in part or part.startswith("r"):
                    return part
            return labelledby.split()[0]

    auto_id = await container.get_attribute("data-automation-id")
    if auto_id and auto_id != "questionItem":
        return auto_id

    return f"ms_field_{page_index}_{index}"


async def _detect_field_type(container: Locator) -> tuple[FieldType, list[str]]:
    options: list[str] = []

    radio_group = container.locator('[role="radiogroup"]')
    if await radio_group.count() > 0:
        options = await _extract_options(container, '[role="radio"]')
        return FieldType.radio, options

    checkbox_group = container.locator('[role="group"]:has([role="checkbox"])')
    if await checkbox_group.count() == 0:
        checkbox_group = container.locator('[role="checkbox"]')
    if await checkbox_group.count() > 0:
        options = await _extract_options(container, '[role="checkbox"]')
        return FieldType.checkbox, options

    listbox = container.locator('[role="listbox"], [data-automation-id="dropdownButton"]')
    if await listbox.count() > 0:
        return FieldType.dropdown, options

    rating = container.locator('[data-automation-id="ratingItem"], [class*="Rating"]')
    if await rating.count() > 0:
        return FieldType.linear_scale, options

    date_input = container.locator('input[type="date"], [data-automation-id="dateInput"]')
    if await date_input.count() > 0:
        return FieldType.date, options

    time_input = container.locator('input[type="time"], [data-automation-id="timeInput"]')
    if await time_input.count() > 0:
        return FieldType.time, options

    textarea = container.locator("textarea")
    if await textarea.count() > 0:
        return FieldType.long_text, options

    return FieldType.short_text, options


async def _fill_empty_controls_round(page: Page) -> int:
    today_iso = date.today().isoformat()
    actions = 0
    containers = await _get_question_containers(page)
    count = await containers.count()

    for i in range(count):
        container = containers.nth(i)
        try:
            actions += await _fill_empty_inputs(container, "textarea", _DISCOVERY_TEXT)
            actions += await _fill_empty_inputs(container, 'input[type="date"]', today_iso)
            actions += await _fill_empty_inputs(container, 'input[type="time"]', _DISCOVERY_TIME)
            actions += await _fill_empty_inputs(
                container,
                "input:not([type='hidden']):not([type='date']):not([type='time']):not([type='radio']):not([type='checkbox'])",
                _DISCOVERY_TEXT,
            )
            actions += await _select_one_radio(container)
            actions += await _select_one_checkbox(container)
            actions += await _select_one_dropdown_option(page, container)
        except Exception:
            continue

    return actions


async def _fill_empty_inputs(container: Locator, selector: str, value: str) -> int:
    filled = 0
    fields = container.locator(selector)
    count = await fields.count()
    for i in range(count):
        field = fields.nth(i)
        try:
            if not await field.is_visible():
                continue
            existing = _normalize_text(await field.input_value())
            if existing:
                continue
            await field.click()
            await field.fill(value)
            filled += 1
        except Exception:
            continue
    return filled


async def _has_checked_role_option(container: Locator, selector: str) -> bool:
    options = container.locator(selector)
    count = await options.count()
    for i in range(count):
        option = options.nth(i)
        try:
            if not await option.is_visible():
                continue
            if await option.get_attribute("aria-checked") == "true":
                return True
        except Exception:
            continue
    return False


async def _click_first_visible_role_option(container: Locator, selector: str) -> int:
    options = container.locator(selector)
    count = await options.count()
    for i in range(count):
        option = options.nth(i)
        try:
            if not await option.is_visible():
                continue
            await option.click()
            return 1
        except Exception:
            continue
    return 0


async def _select_one_radio(container: Locator) -> int:
    if await _has_checked_role_option(container, '[role="radio"]'):
        return 0
    return await _click_first_visible_role_option(container, '[role="radio"]')


async def _select_one_checkbox(container: Locator) -> int:
    if await _has_checked_role_option(container, '[role="checkbox"]'):
        return 0
    return await _click_first_visible_role_option(container, '[role="checkbox"]')


async def _select_one_dropdown_option(page: Page, container: Locator) -> int:
    selected = container.locator('[role="option"][aria-selected="true"]')
    if await selected.count() > 0:
        return 0

    dropdowns = container.locator('[role="listbox"], [data-automation-id="dropdownButton"]')
    count = await dropdowns.count()
    for i in range(count):
        dropdown = dropdowns.nth(i)
        try:
            if not await dropdown.is_visible():
                continue
            await dropdown.click()
            await page.wait_for_timeout(150)
            options = page.locator('[role="option"]')
            option_count = await options.count()
            for j in range(option_count):
                option = options.nth(j)
                if not await option.is_visible():
                    continue
                if await option.get_attribute("aria-selected") == "true":
                    continue
                await option.click()
                return 1
        except Exception:
            continue
    return 0


async def _extract_options(container: Locator, item_selector: str) -> list[str]:
    options: list[str] = []
    items = container.locator(item_selector)
    count = await items.count()
    for i in range(count):
        item = items.nth(i)
        aria_label = _normalize_text(await item.get_attribute("aria-label"))
        if aria_label:
            options.append(aria_label)
            continue
        spans = item.locator("span")
        if await spans.count() > 0:
            text = _normalize_text(await spans.first.inner_text())
            if text:
                options.append(text)
    return options
