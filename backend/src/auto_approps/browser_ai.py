from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from anthropic import AsyncAnthropic

from .config import settings
from .page_model import NavigationElement, PageSnapshot

_SYSTEM_PROMPT = """You pick the forward navigation control on a Microsoft Forms page.
You MUST call the provided tool exactly once.
Never pick Back, Previous, Cancel, Submit, Send, Done, or Finish as a forward action.
If there is no control that clearly advances to the next page, return action NONE.
"""

_TOOL_NAME = "choose_navigation_action"
_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": ["CLICK", "NONE"]},
        "index": {"type": "integer", "minimum": 0},
        "reason": {"type": "string"},
    },
    "required": ["action"],
    "additionalProperties": False,
}


@dataclass(frozen=True)
class NavigationAIDecision:
    action: str
    index: int | None = None
    reason: str = ""
    error_code: str = ""
    error_detail: str = ""



def _candidate_line(item: NavigationElement) -> str:
    return (
        f"index={item.index}; dom_index={item.dom_index}; text='{item.text}'; "
        f"aria='{item.aria_label}'; title='{item.title_attr}'; dataId='{item.data_automation_id}'; "
        f"tag='{item.tag}'; role='{item.role}'; "
        f"visible={item.visible}; disabled={item.disabled}; "
        f"x={int(item.x)}; y={int(item.y)}; w={int(item.width)}; h={int(item.height)}"
    )



def _build_user_prompt(
    snapshot: PageSnapshot,
    candidates: Iterable[NavigationElement],
    retry_context: str = "",
) -> str:
    questions = snapshot.questions[:8]
    lines = [
        f"page_indicator: {snapshot.page_indicator or 'UNKNOWN'}",
        f"questions_visible: {len(snapshot.questions)}",
        "question_samples:",
    ]
    lines.extend(f"- {q}" for q in questions)
    lines.append(f"dom_excerpt: {snapshot.dom_excerpt[:1500]}")
    lines.append("navigation_candidates:")
    lines.extend(f"- {_candidate_line(c)}" for c in candidates)
    if retry_context:
        lines.append(f"retry_context: {retry_context}")
        lines.append(
            "retry_requirement: respond with one tool call and ensure CLICK uses a listed index only"
        )
    return "\n".join(lines)



def _parse_tool_payload(payload: object, valid_indices: set[int]) -> NavigationAIDecision:
    if not isinstance(payload, dict):
        return NavigationAIDecision(
            action="INVALID",
            error_code="tool_payload_not_object",
            error_detail="Tool payload was not a JSON object.",
        )

    action = str(payload.get("action", "")).upper()
    reason = str(payload.get("reason", "")).strip()

    if action == "NONE":
        return NavigationAIDecision(action="NONE", reason=reason)

    if action != "CLICK":
        return NavigationAIDecision(
            action="INVALID",
            reason=reason,
            error_code="unexpected_action",
            error_detail=f"Unsupported action '{action}'.",
        )

    index_value = payload.get("index")
    if not isinstance(index_value, int):
        return NavigationAIDecision(
            action="INVALID",
            reason=reason,
            error_code="missing_or_invalid_index",
            error_detail="CLICK action did not include a valid integer index.",
        )

    if index_value not in valid_indices:
        return NavigationAIDecision(
            action="INVALID",
            reason=reason,
            error_code="index_out_of_range",
            error_detail=f"Index {index_value} is not in provided candidates.",
        )

    return NavigationAIDecision(action="CLICK", index=index_value, reason=reason)


async def choose_next_with_ai(
    snapshot: PageSnapshot,
    candidates: list[NavigationElement],
    *,
    retry_context: str = "",
) -> NavigationAIDecision:
    if not settings.anthropic_api_key:
        return NavigationAIDecision(
            action="INVALID",
            error_code="missing_api_key",
            error_detail="ANTHROPIC_API_KEY is not configured.",
        )

    if not candidates:
        return NavigationAIDecision(action="NONE", reason="No actionable navigation candidates.")

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    prompt = _build_user_prompt(snapshot, candidates, retry_context=retry_context)

    try:
        response = await client.messages.create(
            model=settings.model_name,
            max_tokens=256,
            temperature=0,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
            tools=[
                {
                    "name": _TOOL_NAME,
                    "description": "Choose a forward navigation action for this page.",
                    "input_schema": _TOOL_SCHEMA,
                }
            ],
            tool_choice={"type": "tool", "name": _TOOL_NAME},
        )
    except Exception as exc:
        return NavigationAIDecision(
            action="INVALID",
            error_code="anthropic_request_failed",
            error_detail=str(exc),
        )

    for block in response.content:
        if getattr(block, "type", "") != "tool_use":
            continue
        if getattr(block, "name", "") != _TOOL_NAME:
            continue
        payload = getattr(block, "input", None)
        valid_indices = {item.index for item in candidates}
        return _parse_tool_payload(payload, valid_indices)

    return NavigationAIDecision(
        action="INVALID",
        error_code="missing_tool_use",
        error_detail="Claude did not return the required tool output.",
    )
