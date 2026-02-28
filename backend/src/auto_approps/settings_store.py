from __future__ import annotations

import logging
import os
import re
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"


def read_api_key(path: Path = DEFAULT_ENV_PATH) -> str:
    """Read ANTHROPIC_API_KEY from the .env file."""
    if not path.exists():
        return ""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        logger.warning("Failed reading .env at %s: %s", path, exc)
        return ""
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        if key.strip() == "ANTHROPIC_API_KEY":
            return value.strip()
    return ""


def write_api_key(api_key: str, path: Path = DEFAULT_ENV_PATH) -> None:
    """Update ANTHROPIC_API_KEY in the .env file, preserving other variables."""
    path.parent.mkdir(parents=True, exist_ok=True)

    if path.exists():
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as exc:
            logger.warning("Failed reading .env at %s: %s", path, exc)
            text = ""
    else:
        text = ""

    new_line = f"ANTHROPIC_API_KEY={api_key}"
    if re.search(r"^ANTHROPIC_API_KEY=.*$", text, re.MULTILINE):
        updated = re.sub(r"^ANTHROPIC_API_KEY=.*$", new_line, text, flags=re.MULTILINE)
    else:
        updated = new_line + "\n" + text if text else new_line + "\n"

    tmp_path = path.with_suffix(".env.tmp")
    try:
        tmp_path.write_text(updated, encoding="utf-8")
        os.replace(tmp_path, path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
