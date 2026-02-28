from auto_approps.knowledge_profile_store import (
    load_knowledge_profile,
    save_knowledge_profile,
)
from auto_approps.models import KnowledgeProfileUpdate


def test_load_knowledge_profile_missing_file_returns_defaults(tmp_path):
    profile = load_knowledge_profile(tmp_path / "knowledge_profile.json")

    assert profile.user_context == ""
    assert profile.firm_context == ""
    assert profile.updated_at is None


def test_save_then_load_knowledge_profile_round_trip(tmp_path):
    path = tmp_path / "knowledge_profile.json"
    update = KnowledgeProfileUpdate(
        user_context="User-specific reusable context",
        firm_context="Firm capabilities and policy areas",
    )

    saved = save_knowledge_profile(update, path)
    loaded = load_knowledge_profile(path)

    assert loaded.user_context == update.user_context
    assert loaded.firm_context == update.firm_context
    assert loaded.updated_at is not None
    assert loaded.updated_at == saved.updated_at


def test_load_knowledge_profile_invalid_json_returns_defaults(tmp_path):
    path = tmp_path / "knowledge_profile.json"
    path.write_text("{ not valid json", encoding="utf-8")

    profile = load_knowledge_profile(path)

    assert profile.user_context == ""
    assert profile.firm_context == ""
    assert profile.updated_at is None
