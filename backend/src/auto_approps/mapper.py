from __future__ import annotations

import logging
from difflib import get_close_matches
from typing import Any

from anthropic import AsyncAnthropic

from .config import settings
from .models import (
    DocChunk,
    FieldMapping,
    FormField,
    FormSchema,
    KnowledgeProfile,
    MappingResult,
    ParsedDocument,
)

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert at congressional appropriations and government forms.

Your task: given a parsed document and a form schema, map the document content to form fields.

Rules:
1. For each form field, find the best matching content from the document.
2. For radio/dropdown/checkbox fields, your answer MUST exactly match one of the provided options.
3. Include a source citation for each answer — reference the specific section/paragraph/table row.
4. Rate your confidence: "high" (exact match found), "medium" (inferred from context), "low" (guessing).
5. For number fields, preserve exact precision from the document.
6. If no relevant content exists for a field, leave proposed_answer empty and set confidence to "low".
7. Include brief reasoning for each mapping.
8. You MUST call the provided tool exactly once.
9. For source_chunk_indices, include the integer index of every document chunk you used to derive the answer (from the [Chunk N] markers). Use an empty array if no chunks were referenced.
10. A reusable User/Firm context block may be provided. Treat it as secondary evidence.
11. If reusable profile context conflicts with the uploaded document, prefer the uploaded document.
12. Do not invent client-specific details.
13. If an answer is derived mainly from reusable profile context, set source_citation to "User/Firm Profile".
14. IMPORTANT — Inference for classification and categorical questions:
    Many form fields ask you to CLASSIFY the request (e.g. "Is this Defense Funding?",
    "What type of project is this?", "Which agency does this relate to?"). The answer to
    these questions will almost never be stated verbatim in the document. You MUST analyze
    the document's subject matter, mentioned agencies, programs, funding sources, and
    overall context to infer the correct classification. For example, if the document
    discusses military programs, Department of Defense, defense agencies, or national
    security topics, you should infer it is defense-related. Do NOT default to "N/A",
    "Not applicable", or a generic/catch-all option simply because the classification is
    not explicitly stated. Only leave a classification field empty when the document
    truly provides no contextual signal at all.
15. When a question asks you to choose between categories, always reason through which
    category best fits the document content before answering. Explain your reasoning in
    the reasoning field. A "medium" confidence inference is far more valuable than an
    empty answer or a wrong default.
"""

_TOOL_NAME = "submit_field_mappings"


def _field_alias(index: int) -> str:
    return f"F{index + 1:03d}"


def _build_alias_maps(fields: list[FormField]) -> tuple[dict[str, str], dict[str, str]]:
    alias_to_field_id: dict[str, str] = {}
    field_id_to_alias: dict[str, str] = {}
    for idx, field in enumerate(fields):
        alias = _field_alias(idx)
        alias_to_field_id[alias] = field.field_id
        field_id_to_alias[field.field_id] = alias
    return alias_to_field_id, field_id_to_alias


def _normalize_label(value: str) -> str:
    return " ".join(value.lower().strip().split())


def build_user_message(
    doc: ParsedDocument,
    form: FormSchema,
    field_id_to_alias: dict[str, str],
    knowledge_profile: KnowledgeProfile | None = None,
) -> str:
    parts = ["## Document Content\n"]
    for chunk in doc.chunks:
        parts.append(f"[Chunk {chunk.index}, Source: {chunk.source_location}]\n{chunk.text}\n")

    if knowledge_profile and knowledge_profile.has_content():
        parts.append("\n## Reusable User/Firm Context\n")
        parts.append(
            "Use this context only to fill gaps not covered by the uploaded document. "
            "Do not invent client-specific details."
        )
        if knowledge_profile.user_context.strip():
            parts.append(f"\n[User Knowledge]\n{knowledge_profile.user_context.strip()}\n")
        if knowledge_profile.firm_context.strip():
            parts.append(f"\n[Firm Knowledge]\n{knowledge_profile.firm_context.strip()}\n")

    parts.append("\n## Form Fields\n")
    for field in form.fields:
        alias = field_id_to_alias.get(field.field_id, "")
        desc = (
            f"- **{field.label}** "
            f"(Key: {alias}, ID: {field.field_id}, Type: {field.field_type.value}"
        )
        if field.required:
            desc += ", Required"
        if field.options:
            desc += f", Options: {field.options}"
        desc += ")"
        parts.append(desc)

    parts.append("\n\nReturn mappings for the listed field IDs only.")
    parts.append(
        "Use unmapped_fields only for known form field IDs that truly have no supporting content."
    )
    parts.append(
        "For field_id, prefer the short Key value (for example F001). "
        "Exact original ID values are also accepted."
    )
    parts.append(
        "\nIMPORTANT: For classification or categorical fields (radio, dropdown, checkbox), "
        "analyze the full document context to infer the correct answer — even if the document "
        "does not state the classification explicitly. Do not skip these or default to a "
        "generic catch-all option."
    )

    return "\n".join(parts)


MAPPING_SCHEMA = {
    "type": "object",
    "properties": {
        "mappings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "field_id": {"type": "string"},
                    "field_label": {"type": "string"},
                    "proposed_answer": {"type": "string"},
                    "source_citation": {"type": "string"},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                    "reasoning": {"type": "string"},
                    "source_chunk_indices": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "Indices of the document chunks referenced (from [Chunk N] markers).",
                    },
                },
                "required": [
                    "field_id",
                    "field_label",
                    "proposed_answer",
                    "source_citation",
                    "confidence",
                    "reasoning",
                    "source_chunk_indices",
                ],
                "additionalProperties": False,
            },
        },
        "unmapped_fields": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
    "required": ["mappings", "unmapped_fields"],
    "additionalProperties": False,
}


async def _request_mapping_payload(
    client: AsyncAnthropic,
    user_message: str,
    *,
    retry_context: str = "",
) -> dict:
    prompt = user_message
    if retry_context:
        if retry_context == "zero_non_empty_answers":
            prompt = (
                f"{user_message}\n\n"
                "Retry context: previous output had zero non-empty proposed_answer values. "
                "Re-evaluate the document and provide best-effort non-empty answers wherever any evidence exists. "
                "Use empty answers only when there is truly no support in the document. "
                "Return one valid tool payload only."
            )
        else:
            prompt = (
                f"{user_message}\n\n"
                f"Retry context: previous output violated structured contract ({retry_context}). "
                "Return one valid tool payload only."
            )

    response = await client.messages.create(
        model=settings.model_name,
        max_tokens=4096,
        temperature=0,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
        tools=[
            {
                "name": _TOOL_NAME,
                "description": "Submit field mappings in the required structured schema.",
                "input_schema": MAPPING_SCHEMA,
            }
        ],
        tool_choice={"type": "tool", "name": _TOOL_NAME},
    )

    for block in response.content:
        if getattr(block, "type", "") != "tool_use":
            continue
        if getattr(block, "name", "") != _TOOL_NAME:
            continue
        payload = getattr(block, "input", None)
        if not isinstance(payload, dict):
            raise ValueError("Tool payload was not a JSON object")
        return payload

    raise ValueError("Claude did not return required structured tool output")


def _count_non_empty_raw_answers(result_data: dict[str, Any]) -> int:
    count = 0
    for raw_mapping in result_data.get("mappings", []):
        if not isinstance(raw_mapping, dict):
            continue
        proposed = raw_mapping.get("proposed_answer")
        if isinstance(proposed, str) and proposed.strip():
            count += 1
    return count


def _resolve_field_id(
    raw_field_id: str,
    raw_field_label: str,
    *,
    alias_to_field_id: dict[str, str],
    field_lookup: dict[str, FormField],
    lower_field_id_lookup: dict[str, str],
    normalized_label_lookup: dict[str, str],
) -> str | None:
    if raw_field_id in field_lookup:
        return raw_field_id

    if raw_field_id in alias_to_field_id:
        return alias_to_field_id[raw_field_id]

    lowered_id = raw_field_id.lower()
    if lowered_id in lower_field_id_lookup:
        return lower_field_id_lookup[lowered_id]

    normalized_label = _normalize_label(raw_field_label)
    if normalized_label and normalized_label in normalized_label_lookup:
        return normalized_label_lookup[normalized_label]

    if normalized_label:
        candidates = list(normalized_label_lookup.keys())
        label_matches = get_close_matches(normalized_label, candidates, n=1, cutoff=0.82)
        if label_matches:
            return normalized_label_lookup[label_matches[0]]

    if raw_field_id:
        id_matches = get_close_matches(raw_field_id.lower(), list(lower_field_id_lookup.keys()), n=1, cutoff=0.85)
        if id_matches:
            return lower_field_id_lookup[id_matches[0]]

    return None


async def map_fields(
    doc: ParsedDocument,
    form: FormSchema,
    knowledge_profile: KnowledgeProfile | None = None,
) -> MappingResult:
    if not settings.anthropic_api_key:
        raise ValueError("ANTHROPIC_API_KEY is not configured")

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    alias_to_field_id, field_id_to_alias = _build_alias_maps(form.fields)
    user_message = build_user_message(
        doc,
        form,
        field_id_to_alias,
        knowledge_profile=knowledge_profile,
    )

    retries = max(1, settings.mapping_ai_retries + 1)
    result_data: dict | None = None
    last_error = ""

    for attempt in range(retries):
        retry_context = last_error if attempt > 0 else ""
        try:
            result_data = await _request_mapping_payload(
                client,
                user_message,
                retry_context=retry_context,
            )
            non_empty_raw = _count_non_empty_raw_answers(result_data)
            if non_empty_raw == 0 and form.fields and doc.chunks and attempt < (retries - 1):
                last_error = "zero_non_empty_answers"
                logger.warning(
                    "Claude returned 0 non-empty answers on attempt %s/%s; retrying mapping.",
                    attempt + 1,
                    retries,
                )
                continue
            break
        except Exception as exc:
            last_error = str(exc)
            if attempt == retries - 1:
                raise ValueError(
                    "Could not parse Claude structured mapping output: "
                    f"{last_error}"
                ) from exc

    if result_data is None:
        raise ValueError("Could not parse Claude structured mapping output: empty result")

    field_lookup: dict[str, FormField] = {f.field_id: f for f in form.fields}
    lower_field_id_lookup: dict[str, str] = {field_id.lower(): field_id for field_id in field_lookup}
    normalized_label_lookup: dict[str, str] = {
        _normalize_label(field.label): field.field_id
        for field in form.fields
        if _normalize_label(field.label)
    }

    chunk_by_index: dict[int, DocChunk] = {c.index: c for c in doc.chunks}

    mapping_by_field_id: dict[str, FieldMapping] = {}
    dropped_unknown: list[str] = []
    for raw_mapping in result_data.get("mappings", []):
        if not isinstance(raw_mapping, dict):
            logger.warning("Dropping non-object mapping payload entry: %r", raw_mapping)
            continue

        raw_field_id = str(raw_mapping.get("field_id", "")).strip()
        raw_field_label = str(raw_mapping.get("field_label", "")).strip()
        resolved_field_id = _resolve_field_id(
            raw_field_id,
            raw_field_label,
            alias_to_field_id=alias_to_field_id,
            field_lookup=field_lookup,
            lower_field_id_lookup=lower_field_id_lookup,
            normalized_label_lookup=normalized_label_lookup,
        )
        if not resolved_field_id:
            dropped_unknown.append(f"id='{raw_field_id}' label='{raw_field_label}'")
            continue

        # Resolve source_chunk_indices to actual DocChunk objects
        raw_indices = raw_mapping.pop("source_chunk_indices", [])
        source_chunks: list[DocChunk] = []
        if isinstance(raw_indices, list):
            for idx in raw_indices:
                if isinstance(idx, int) and idx in chunk_by_index:
                    source_chunks.append(chunk_by_index[idx])

        normalized_payload = dict(raw_mapping)
        normalized_payload["field_id"] = resolved_field_id
        normalized_payload["source_chunks"] = source_chunks
        if not normalized_payload.get("field_label"):
            normalized_payload["field_label"] = field_lookup[resolved_field_id].label

        try:
            mapping = FieldMapping(**normalized_payload)
        except Exception as exc:
            logger.warning("Dropping invalid mapping payload: %s", exc)
            continue

        field = field_lookup.get(mapping.field_id)
        if not field:
            logger.warning("Dropping mapping for unknown field_id: %s", mapping.field_id)
            continue
        if field.options and mapping.proposed_answer:
            mapping.proposed_answer = _validate_choice(mapping.proposed_answer, field.options)
        mapping_by_field_id[field.field_id] = mapping

    unmapped_fields: list[str] = []
    seen_unmapped: set[str] = set()
    for field_id in result_data.get("unmapped_fields", []):
        if not isinstance(field_id, str):
            continue
        resolved_unmapped = _resolve_field_id(
            field_id.strip(),
            "",
            alias_to_field_id=alias_to_field_id,
            field_lookup=field_lookup,
            lower_field_id_lookup=lower_field_id_lookup,
            normalized_label_lookup=normalized_label_lookup,
        )
        if not resolved_unmapped:
            logger.warning("Dropping unknown field_id in unmapped_fields: %s", field_id)
            continue
        if resolved_unmapped in seen_unmapped:
            continue
        seen_unmapped.add(resolved_unmapped)
        unmapped_fields.append(resolved_unmapped)

    # Guarantee one mapping row per scraped field so the review UI can always render every question.
    mappings: list[FieldMapping] = []
    for field in form.fields:
        existing = mapping_by_field_id.get(field.field_id)
        if existing:
            mappings.append(existing)
            if not existing.proposed_answer and field.field_id not in seen_unmapped:
                seen_unmapped.add(field.field_id)
                unmapped_fields.append(field.field_id)
            continue

        mappings.append(
            FieldMapping(
                field_id=field.field_id,
                field_label=field.label,
                proposed_answer="",
                source_citation="",
                confidence="low",
                reasoning="No supported mapping returned for this field.",
            )
        )
        if field.field_id not in seen_unmapped:
            seen_unmapped.add(field.field_id)
            unmapped_fields.append(field.field_id)

    non_empty_final = sum(1 for mapping in mappings if mapping.proposed_answer.strip())
    if dropped_unknown:
        logger.warning(
            "Dropped %s unresolved mapping rows (examples: %s)",
            len(dropped_unknown),
            "; ".join(dropped_unknown[:5]),
        )
    logger.info(
        "Mapping summary: fields=%s raw_rows=%s resolved_rows=%s non_empty=%s unmapped=%s",
        len(form.fields),
        len(result_data.get("mappings", [])),
        len(mapping_by_field_id),
        non_empty_final,
        len(unmapped_fields),
    )
    if non_empty_final == 0 and form.fields and doc.chunks:
        logger.warning(
            "Mapping produced zero non-empty answers despite non-empty document and field set."
        )

    return MappingResult(
        mappings=mappings,
        unmapped_fields=unmapped_fields,
        doc_chunks=list(doc.chunks),
    )


def _validate_choice(answer: str, options: list[str]) -> str:
    """If answer doesn't exactly match an option, try fuzzy matching."""
    if answer in options:
        return answer
    matches = get_close_matches(answer, options, n=1, cutoff=0.6)
    if matches:
        return matches[0]
    return answer
