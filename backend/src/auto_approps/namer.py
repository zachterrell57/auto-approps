from __future__ import annotations

import logging

from anthropic import AsyncAnthropic

from .config import settings

logger = logging.getLogger(__name__)

NAMING_MODEL = "claude-haiku-4-5-20251001"


async def generate_session_name(
    *,
    document_filename: str,
    form_title: str,
    form_field_labels: list[str] | None = None,
) -> str:
    """Call Haiku to produce a short, descriptive session name."""
    if not settings.anthropic_api_key:
        return form_title or document_filename

    context_parts = []
    if document_filename:
        context_parts.append(f"Document: {document_filename}")
    if form_title:
        context_parts.append(f"Form: {form_title}")
    if form_field_labels:
        preview = ", ".join(form_field_labels[:8])
        context_parts.append(f"Fields: {preview}")

    if not context_parts:
        return "Untitled Session"

    prompt = (
        "Generate a short, descriptive name (max 6 words) for a form-filling session "
        "based on the following context. Return ONLY the name, nothing else.\n\n"
        + "\n".join(context_parts)
    )

    try:
        client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        response = await client.messages.create(
            model=NAMING_MODEL,
            max_tokens=30,
            temperature=0.7,
            messages=[{"role": "user", "content": prompt}],
        )
        name = response.content[0].text.strip().strip('"').strip("'")
        # Truncate if too long
        if len(name) > 80:
            name = name[:77] + "..."
        return name or form_title or document_filename
    except Exception as exc:
        logger.warning("Failed to generate session name via Haiku: %s", exc)
        return form_title or document_filename
