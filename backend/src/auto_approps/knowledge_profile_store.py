from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from pydantic import ValidationError

from .models import KnowledgeProfile, KnowledgeProfileUpdate

logger = logging.getLogger(__name__)

DEFAULT_KNOWLEDGE_PROFILE_PATH = (
    Path(__file__).resolve().parents[2] / "data" / "knowledge_profile.json"
)


def load_knowledge_profile(
    path: Path = DEFAULT_KNOWLEDGE_PROFILE_PATH,
) -> KnowledgeProfile:
    if not path.exists():
        return KnowledgeProfile()

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        logger.warning("Invalid knowledge profile JSON at %s; falling back to defaults.", path)
        return KnowledgeProfile()
    except OSError as exc:
        logger.warning("Failed reading knowledge profile at %s: %s", path, exc)
        return KnowledgeProfile()

    try:
        return KnowledgeProfile.model_validate(raw)
    except ValidationError as exc:
        logger.warning("Invalid knowledge profile payload at %s: %s", path, exc)
        return KnowledgeProfile()


def save_knowledge_profile(
    update: KnowledgeProfileUpdate,
    path: Path = DEFAULT_KNOWLEDGE_PROFILE_PATH,
) -> KnowledgeProfile:
    profile = KnowledgeProfile(
        user_context=update.user_context,
        firm_context=update.firm_context,
        updated_at=datetime.now(timezone.utc).isoformat(),
    )

    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(profile.model_dump(), ensure_ascii=True, indent=2) + "\n"

    tmp_path = path.with_suffix(f"{path.suffix}.tmp")
    try:
        tmp_path.write_text(payload, encoding="utf-8")
        os.replace(tmp_path, path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)

    return profile
