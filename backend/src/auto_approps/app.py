from __future__ import annotations

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from .config import settings
from .doc_parser import parse_docx
from .form_scraper import scrape_form
from .generic_form_scraper import scrape_generic_form
from .knowledge_profile_store import load_knowledge_profile, save_knowledge_profile
from .mapper import map_fields
from .models import (
    FormSchema,
    KnowledgeProfileUpdate,
    ParsedDocument,
    SessionCreate,
    SessionRename,
    SessionUpdateMappings,
)
from .ms_form_scraper import scrape_ms_form
from .provider import FormProvider, detect_provider
from .namer import generate_session_name
from .session_store import (
    create_session,
    delete_session,
    get_session,
    get_session_document,
    list_sessions,
    rename_session,
    update_session_mappings,
)
from .settings_store import read_api_key, write_api_key

app = FastAPI(title="AutoApprops", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory state for the current session
_state: dict = {}


@app.post("/api/upload")
async def upload_document(file: UploadFile = File(...)):
    if not file.filename or not file.filename.endswith(".docx"):
        raise HTTPException(400, "Only .docx files are supported")

    content = await file.read()
    parsed = parse_docx(content, file.filename)
    _state["parsed_doc"] = parsed
    _state["raw_docx_bytes"] = content
    return {
        "filename": parsed.filename,
        "chunk_count": len(parsed.chunks),
        "preview": parsed.full_text[:500],
    }


@app.get("/api/document")
async def get_document():
    raw = _state.get("raw_docx_bytes")
    if not raw:
        raise HTTPException(400, "No document uploaded")
    parsed_doc: ParsedDocument | None = _state.get("parsed_doc")
    filename = parsed_doc.filename if parsed_doc else "document.docx"
    return Response(
        content=raw,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


class ScrapeRequest(BaseModel):
    url: str


@app.get("/api/knowledge-profile")
async def get_knowledge_profile():
    try:
        profile = load_knowledge_profile()
    except Exception as e:
        raise HTTPException(500, f"Failed to load knowledge profile: {e}")
    return profile.model_dump()


@app.put("/api/knowledge-profile")
async def put_knowledge_profile(req: KnowledgeProfileUpdate):
    try:
        profile = save_knowledge_profile(req)
    except Exception as e:
        raise HTTPException(500, f"Failed to save knowledge profile: {e}")
    return profile.model_dump()


class SettingsResponse(BaseModel):
    anthropic_api_key_set: bool
    anthropic_api_key_preview: str


class SettingsUpdate(BaseModel):
    anthropic_api_key: str


def _mask_key(key: str) -> str:
    if len(key) <= 8:
        return "*" * len(key) if key else ""
    return key[:7] + "..." + key[-4:]


@app.get("/api/settings")
async def get_settings() -> SettingsResponse:
    key = read_api_key()
    return SettingsResponse(
        anthropic_api_key_set=bool(key),
        anthropic_api_key_preview=_mask_key(key),
    )


@app.put("/api/settings")
async def put_settings(req: SettingsUpdate) -> SettingsResponse:
    key = req.anthropic_api_key.strip()
    try:
        write_api_key(key)
    except Exception as e:
        raise HTTPException(500, f"Failed to save settings: {e}")
    # Update the in-memory config so subsequent requests use the new key
    settings.anthropic_api_key = key
    return SettingsResponse(
        anthropic_api_key_set=bool(key),
        anthropic_api_key_preview=_mask_key(key),
    )


@app.post("/api/scrape")
async def scrape_form_endpoint(req: ScrapeRequest):
    provider = detect_provider(req.url)

    try:
        if provider == FormProvider.microsoft:
            schema = await scrape_ms_form(req.url)
        elif provider == FormProvider.generic:
            schema = await scrape_generic_form(req.url)
        else:
            schema = await scrape_form(req.url)
            schema.provider = "google"
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Failed to scrape form: {e}")

    _state["form_schema"] = schema
    return schema.model_dump()


@app.post("/api/map")
async def map_endpoint():
    parsed_doc: ParsedDocument | None = _state.get("parsed_doc")
    form_schema: FormSchema | None = _state.get("form_schema")

    if not parsed_doc:
        raise HTTPException(400, "No document uploaded. Upload a .docx first.")
    if not form_schema:
        raise HTTPException(400, "No form scraped. Scrape a form first.")

    knowledge_profile = None
    loaded_profile = load_knowledge_profile()
    if loaded_profile.has_content():
        knowledge_profile = loaded_profile

    try:
        result = await map_fields(parsed_doc, form_schema, knowledge_profile=knowledge_profile)
    except Exception as e:
        raise HTTPException(500, f"Mapping failed: {e}")

    _state["mapping_result"] = result
    return result.model_dump()


@app.get("/api/sessions")
async def list_sessions_endpoint():
    return list_sessions()


@app.get("/api/sessions/{session_id}")
async def get_session_endpoint(session_id: str):
    session = get_session(session_id)
    if session is None:
        raise HTTPException(404, "Session not found")
    return session


@app.get("/api/sessions/{session_id}/document")
async def get_session_document_endpoint(session_id: str):
    result = get_session_document(session_id)
    if result is None:
        raise HTTPException(404, "Session not found")
    doc_bytes, filename = result
    return Response(
        content=doc_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@app.post("/api/sessions")
async def create_session_endpoint(req: SessionCreate):
    raw_bytes = _state.get("raw_docx_bytes")
    if not raw_bytes:
        raise HTTPException(400, "No document in memory. Upload a document first.")
    try:
        meta = create_session(
            document_filename=req.document_filename,
            document_bytes=raw_bytes,
            form_url=req.form_url,
            form_title=req.form_title,
            form_provider=req.form_provider,
            form_schema=req.form_schema,
            mapping_result=req.mapping_result,
        )
    except Exception as e:
        raise HTTPException(500, f"Failed to create session: {e}")
    return meta


@app.put("/api/sessions/{session_id}/name")
async def rename_session_endpoint(session_id: str, req: SessionRename):
    if not rename_session(session_id, req.display_name):
        raise HTTPException(404, "Session not found")
    return {"ok": True, "display_name": req.display_name}


@app.post("/api/sessions/{session_id}/generate-name")
async def generate_session_name_endpoint(session_id: str):
    session = get_session(session_id)
    if session is None:
        raise HTTPException(404, "Session not found")

    form_schema = session.get("form_schema", {})
    field_labels = [f.get("label", "") for f in form_schema.get("fields", [])]

    name = await generate_session_name(
        document_filename=session.get("document_filename", ""),
        form_title=session.get("form_title", ""),
        form_field_labels=field_labels,
    )

    rename_session(session_id, name)
    return {"display_name": name}


@app.put("/api/sessions/{session_id}/mappings")
async def update_session_mappings_endpoint(
    session_id: str, req: SessionUpdateMappings
):
    if not update_session_mappings(session_id, req.mappings):
        raise HTTPException(404, "Session not found")
    return {"ok": True}


@app.delete("/api/sessions/{session_id}")
async def delete_session_endpoint(session_id: str):
    if not delete_session(session_id):
        raise HTTPException(404, "Session not found")
    return {"ok": True}


def main():
    import os
    import uvicorn
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("auto_approps.app:app", host="0.0.0.0", port=port, reload=True)


if __name__ == "__main__":
    main()
