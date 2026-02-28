from __future__ import annotations

import logging
from dataclasses import dataclass

from playwright.async_api import Page

from .browser_ai import NavigationAIDecision, choose_next_with_ai
from .config import settings
from .page_model import NavigationElement, PageSnapshot, click_navigation_by_dom_index, get_page_snapshot

logger = logging.getLogger(__name__)

_FORWARD_TOKENS = ("next", "continue", "proceed", "review", "ok")
_STOP_TOKENS = ("back", "previous", "cancel")
_SUBMIT_TOKENS = ("submit", "send", "done", "finish")


@dataclass(frozen=True)
class NavigationContext:
    form_url: str
    max_pages: int


@dataclass(frozen=True)
class NavigationOutcome:
    moved: bool
    snapshot: PageSnapshot
    source: str = "none"
    should_stop: bool = False
    reason_code: str = ""
    reason_detail: str = ""



def new_navigation_context(form_url: str) -> NavigationContext:
    return NavigationContext(
        form_url=form_url,
        max_pages=max(1, settings.ms_nav_max_pages),
    )



def _candidate_blob(item: NavigationElement) -> str:
    return " ".join(
        [
            item.text,
            item.aria_label,
            item.title_attr,
            item.data_automation_id,
            item.role,
            item.tag,
        ]
    ).lower()



def _is_stop_or_submit_candidate(item: NavigationElement) -> bool:
    blob = _candidate_blob(item)
    return any(token in blob for token in _STOP_TOKENS + _SUBMIT_TOKENS)


def _has_disabled_forward_control(snapshot: PageSnapshot) -> bool:
    for item in snapshot.navigation:
        if not item.visible or not item.disabled:
            continue
        blob = _candidate_blob(item)
        if any(token in blob for token in _FORWARD_TOKENS):
            return True
    return False


def _has_submit_control(snapshot: PageSnapshot) -> bool:
    for item in snapshot.navigation:
        if not item.visible:
            continue
        blob = _candidate_blob(item)
        if any(token in blob for token in _SUBMIT_TOKENS):
            return True
    return False



def _actionable_candidates(snapshot: PageSnapshot) -> list[NavigationElement]:
    return [
        item
        for item in snapshot.navigation
        if item.visible and not item.disabled and not _is_stop_or_submit_candidate(item)
    ]


async def _wait_for_transition(page: Page, previous_signature: str) -> PageSnapshot | None:
    elapsed = 0
    timeout_ms = settings.ms_nav_transition_timeout_ms
    while elapsed <= timeout_ms:
        await page.wait_for_timeout(250)
        elapsed += 250
        snapshot = await get_page_snapshot(page)
        if snapshot.signature != previous_signature:
            return snapshot
    return None



def _invalid_outcome(current: PageSnapshot, decision: NavigationAIDecision) -> NavigationOutcome:
    return NavigationOutcome(
        moved=False,
        snapshot=current,
        source="ai",
        should_stop=True,
        reason_code=decision.error_code or "ai_invalid_response",
        reason_detail=decision.error_detail or "AI response was invalid.",
    )


async def navigate_to_next_page(
    page: Page,
    context: NavigationContext,
    snapshot: PageSnapshot | None = None,
) -> NavigationOutcome:
    _ = context  # reserved for future provider- or form-specific behavior
    current = snapshot or await get_page_snapshot(page)
    candidates = _actionable_candidates(current)

    if not candidates:
        if _has_disabled_forward_control(current):
            return NavigationOutcome(
                moved=False,
                snapshot=current,
                source="ai",
                should_stop=False,
                reason_code="forward_control_disabled",
                reason_detail="Forward navigation appears disabled by required unanswered fields.",
            )
        if _has_submit_control(current):
            return NavigationOutcome(
                moved=False,
                snapshot=current,
                source="ai",
                should_stop=True,
                reason_code="no_forward_control",
                reason_detail="Submit control detected and no forward navigation is available.",
            )
        return NavigationOutcome(
            moved=False,
            snapshot=current,
            source="ai",
            should_stop=False,
            reason_code="no_actionable_candidates",
            reason_detail="No visible enabled forward navigation candidates were found.",
        )

    max_attempts = max(1, settings.ms_nav_ai_retries + 1)
    retry_context = ""

    for attempt in range(max_attempts):
        decision = await choose_next_with_ai(
            current,
            candidates,
            retry_context=retry_context,
        )

        if decision.action == "NONE":
            return NavigationOutcome(
                moved=False,
                snapshot=current,
                source="ai",
                should_stop=True,
                reason_code="no_forward_control",
                reason_detail=decision.reason or "AI reported no forward control.",
            )

        if decision.action != "CLICK" or decision.index is None:
            retry_context = decision.error_code or "invalid_ai_response"
            if attempt < (max_attempts - 1):
                logger.warning(
                    "MS nav AI invalid response on attempt %s/%s: code=%s detail=%s",
                    attempt + 1,
                    max_attempts,
                    decision.error_code,
                    decision.error_detail,
                )
                continue
            return _invalid_outcome(current, decision)

        candidate = next((item for item in candidates if item.index == decision.index), None)
        if not candidate:
            decision = NavigationAIDecision(
                action="INVALID",
                error_code="candidate_not_found",
                error_detail=f"Chosen index {decision.index} was not in actionable candidates.",
            )
            retry_context = decision.error_code
            if attempt < (max_attempts - 1):
                logger.warning(
                    "MS nav AI chose stale candidate on attempt %s/%s: %s",
                    attempt + 1,
                    max_attempts,
                    decision.error_detail,
                )
                continue
            return _invalid_outcome(current, decision)

        try:
            clicked = await click_navigation_by_dom_index(page, candidate.dom_index)
        except Exception as exc:
            return NavigationOutcome(
                moved=False,
                snapshot=current,
                source="ai",
                should_stop=False,
                reason_code="click_failed",
                reason_detail=str(exc),
            )

        if not clicked:
            return NavigationOutcome(
                moved=False,
                snapshot=current,
                source="ai",
                should_stop=False,
                reason_code="click_target_missing",
                reason_detail=f"Candidate dom index {candidate.dom_index} no longer exists.",
            )

        transitioned = await _wait_for_transition(page, current.signature)
        if transitioned:
            return NavigationOutcome(moved=True, snapshot=transitioned, source="ai")

        return NavigationOutcome(
            moved=False,
            snapshot=current,
            source="ai",
            should_stop=False,
            reason_code="no_transition_after_click",
            reason_detail=(
                f"Clicked candidate index {candidate.index} (dom {candidate.dom_index}) "
                "but page signature did not change."
            ),
        )

    return NavigationOutcome(
        moved=False,
        snapshot=current,
        source="ai",
        should_stop=True,
        reason_code="ai_navigation_exhausted",
        reason_detail="AI navigation exhausted retry budget without a valid click.",
    )
