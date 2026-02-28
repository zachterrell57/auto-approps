from __future__ import annotations

import json
import re

import httpx

from .models import FieldType, FormField, FormSchema

# Google Forms type codes → our FieldType
_TYPE_MAP = {
    0: FieldType.short_text,
    1: FieldType.long_text,
    2: FieldType.radio,
    3: FieldType.dropdown,
    4: FieldType.checkbox,
    5: FieldType.linear_scale,
    9: FieldType.date,
    10: FieldType.time,
}


async def scrape_form(url: str) -> FormSchema:
    """Scrape a Google Form URL and return its schema."""
    # Normalize URL to viewform
    url = re.sub(r"/edit(\?.*)?$", "/viewform", url)
    if "/viewform" not in url:
        url = url.rstrip("/") + "/viewform"

    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        html = resp.text

    # Check for login-required
    if "accounts.google.com/ServiceLogin" in html or "accounts.google.com/v3/signin" in html:
        raise ValueError("This form requires Google login. Please open it in a browser, log in, then try again.")

    # Try FB_PUBLIC_LOAD_DATA_ extraction
    fields = _parse_fb_public_load_data(html)
    title = _extract_title(html)

    if not fields:
        # Fallback: try simpler regex for entry IDs
        fields = _parse_entry_ids_fallback(html)

    page_count = max((f.page_index for f in fields), default=0) + 1

    return FormSchema(
        title=title,
        description="",
        fields=fields,
        page_count=page_count,
        url=url,
    )


def _extract_title(html: str) -> str:
    match = re.search(r"<title>(.*?)</title>", html, re.DOTALL)
    if match:
        title = match.group(1).strip()
        # Remove " - Google Forms" suffix
        title = re.sub(r"\s*-\s*Google Forms$", "", title)
        return title
    return "Untitled Form"


def _parse_fb_public_load_data(html: str) -> list[FormField]:
    """Parse the FB_PUBLIC_LOAD_DATA_ JavaScript variable."""
    match = re.search(r"var\s+FB_PUBLIC_LOAD_DATA_\s*=\s*(\[.*?\]);\s*</script>", html, re.DOTALL)
    if not match:
        return []

    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError:
        return []

    fields: list[FormField] = []
    # data[1][1] contains the field items
    try:
        items = data[1][1]
    except (IndexError, TypeError):
        return []

    if not items:
        return []

    page_index = 0
    for item in items:
        if not isinstance(item, list) or len(item) < 2:
            continue

        label = item[1] if item[1] else ""

        # item[3] indicates a page break / section header
        if item[3] == 8:
            page_index += 1
            continue

        # item[4] contains field answer metadata
        answer_data = item[4] if len(item) > 4 and item[4] else None
        if not answer_data or not isinstance(answer_data, list) or len(answer_data) == 0:
            continue

        field_meta = answer_data[0]
        if not isinstance(field_meta, list) or len(field_meta) < 2:
            continue

        type_code = field_meta[3] if len(field_meta) > 3 else 0
        field_type = _TYPE_MAP.get(type_code, FieldType.short_text)

        entry_id = f"entry.{field_meta[0]}"
        required = bool(field_meta[2]) if len(field_meta) > 2 else False

        # Extract options for choice fields
        options: list[str] = []
        if field_meta[1] and isinstance(field_meta[1], list):
            for opt in field_meta[1]:
                if isinstance(opt, list) and len(opt) > 0 and opt[0]:
                    options.append(str(opt[0]))

        fields.append(FormField(
            field_id=entry_id,
            label=str(label),
            field_type=field_type,
            required=required,
            options=options,
            page_index=page_index,
        ))

    return fields


def _parse_entry_ids_fallback(html: str) -> list[FormField]:
    """Fallback: extract entry IDs and labels from HTML."""
    fields: list[FormField] = []
    seen = set()

    # Find entry IDs
    for match in re.finditer(r'name="(entry\.\d+)"', html):
        entry_id = match.group(1)
        if entry_id in seen:
            continue
        seen.add(entry_id)

        # Try to find a nearby label
        label = ""
        label_match = re.search(
            rf'aria-label="([^"]*)"[^>]*name="{re.escape(entry_id)}"',
            html,
        )
        if label_match:
            label = label_match.group(1)

        fields.append(FormField(
            field_id=entry_id,
            label=label or entry_id,
            field_type=FieldType.short_text,
        ))

    return fields
