from fastapi.testclient import TestClient

from auto_approps import app as app_module
from auto_approps.knowledge_profile_store import (
    load_knowledge_profile,
    save_knowledge_profile,
)
from auto_approps.models import (
    DocChunk,
    FieldMapping,
    FieldType,
    FormField,
    FormSchema,
    MappingResult,
    ParsedDocument,
)


def _seed_state():
    app_module._state["parsed_doc"] = ParsedDocument(
        filename="test.docx",
        chunks=[
            DocChunk(
                text="Document content",
                source_location="Paragraph 1",
                chunk_type="paragraph",
                heading_context="",
                index=0,
            )
        ],
        full_text="Document content",
    )
    app_module._state["form_schema"] = FormSchema(
        title="Sample Form",
        fields=[
            FormField(
                field_id="entry.1",
                label="Question 1",
                field_type=FieldType.short_text,
            )
        ],
    )


def test_knowledge_profile_get_returns_defaults(tmp_path, monkeypatch):
    path = tmp_path / "knowledge_profile.json"
    monkeypatch.setattr(app_module, "load_knowledge_profile", lambda: load_knowledge_profile(path))
    monkeypatch.setattr(
        app_module,
        "save_knowledge_profile",
        lambda payload: save_knowledge_profile(payload, path),
    )

    with TestClient(app_module.app) as client:
        response = client.get("/api/knowledge-profile")

    assert response.status_code == 200
    body = response.json()
    assert body["user_context"] == ""
    assert body["firm_context"] == ""
    assert body["updated_at"] is None


def test_knowledge_profile_put_persists_and_returns_saved_profile(tmp_path, monkeypatch):
    path = tmp_path / "knowledge_profile.json"
    monkeypatch.setattr(app_module, "load_knowledge_profile", lambda: load_knowledge_profile(path))
    monkeypatch.setattr(
        app_module,
        "save_knowledge_profile",
        lambda payload: save_knowledge_profile(payload, path),
    )

    with TestClient(app_module.app) as client:
        put_response = client.put(
            "/api/knowledge-profile",
            json={
                "user_context": "User context for reusable form answers",
                "firm_context": "Firm context for reusable form answers",
            },
        )
        get_response = client.get("/api/knowledge-profile")

    assert put_response.status_code == 200
    assert get_response.status_code == 200

    put_body = put_response.json()
    get_body = get_response.json()
    assert put_body["updated_at"] is not None
    assert get_body["user_context"] == "User context for reusable form answers"
    assert get_body["firm_context"] == "Firm context for reusable form answers"
    assert get_body["updated_at"] == put_body["updated_at"]


def test_map_endpoint_always_uses_profile_context_when_profile_present(tmp_path, monkeypatch):
    path = tmp_path / "knowledge_profile.json"
    monkeypatch.setattr(app_module, "load_knowledge_profile", lambda: load_knowledge_profile(path))
    monkeypatch.setattr(
        app_module,
        "save_knowledge_profile",
        lambda payload: save_knowledge_profile(payload, path),
    )

    seen_profile_flags: list[bool] = []

    async def fake_map_fields(doc, form, knowledge_profile=None):
        _ = doc
        _ = form
        seen_profile_flags.append(knowledge_profile is not None)
        return MappingResult(
            mappings=[
                FieldMapping(
                    field_id="entry.1",
                    field_label="Question 1",
                    proposed_answer="Answer",
                    source_citation="Paragraph 1",
                    confidence="high",
                    reasoning="Exact match",
                )
            ],
            unmapped_fields=[],
        )

    monkeypatch.setattr(app_module, "map_fields", fake_map_fields)
    app_module._state.clear()
    _seed_state()

    with TestClient(app_module.app) as client:
        profile_response = client.put(
            "/api/knowledge-profile",
            json={
                "user_context": "Reusable user knowledge",
                "firm_context": "Reusable firm knowledge",
            },
        )
        map_response_default = client.post("/api/map")
        map_response_opt_out = client.post("/api/map", json={"use_profile_context": False})

    app_module._state.clear()
    assert profile_response.status_code == 200
    assert map_response_default.status_code == 200
    assert map_response_opt_out.status_code == 200
    assert seen_profile_flags == [True, True]
