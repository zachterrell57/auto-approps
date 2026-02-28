from __future__ import annotations

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .config import settings
from .doc_parser import parse_docx
from .form_scraper import scrape_form
from .knowledge_profile_store import load_knowledge_profile, save_knowledge_profile
from .mapper import map_fields
from .models import FormSchema, KnowledgeProfileUpdate, MapRequest, ParsedDocument
from .ms_form_scraper import scrape_ms_form
from .provider import FormProvider, detect_provider
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
    return {
        "filename": parsed.filename,
        "chunk_count": len(parsed.chunks),
        "preview": parsed.full_text[:500],
    }


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
    try:
        provider = detect_provider(req.url)
    except ValueError as e:
        raise HTTPException(400, str(e))

    try:
        if provider == FormProvider.microsoft:
            schema = await scrape_ms_form(req.url)
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
async def map_endpoint(req: MapRequest | None = None):
    parsed_doc: ParsedDocument | None = _state.get("parsed_doc")
    form_schema: FormSchema | None = _state.get("form_schema")

    if not parsed_doc:
        raise HTTPException(400, "No document uploaded. Upload a .docx first.")
    if not form_schema:
        raise HTTPException(400, "No form scraped. Scrape a form first.")

    use_profile_context = True if req is None else req.use_profile_context
    knowledge_profile = None
    if use_profile_context:
        loaded_profile = load_knowledge_profile()
        if loaded_profile.has_content():
            knowledge_profile = loaded_profile

    try:
        result = await map_fields(parsed_doc, form_schema, knowledge_profile=knowledge_profile)
    except Exception as e:
        raise HTTPException(500, f"Mapping failed: {e}")

    _state["mapping_result"] = result
    return result.model_dump()


def main():
    import os
    import uvicorn
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("auto_approps.app:app", host="0.0.0.0", port=port, reload=True)


if __name__ == "__main__":
    main()
