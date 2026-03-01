from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class DocChunk(BaseModel):
    text: str
    source_location: str
    chunk_type: str  # "paragraph", "table_row", "heading"
    heading_context: str = ""
    heading_level: int = 0  # 1-6 for headings, 0 for non-headings
    index: int = 0


class ParsedDocument(BaseModel):
    filename: str
    chunks: list[DocChunk]
    full_text: str


class FieldType(str, Enum):
    short_text = "short_text"
    long_text = "long_text"
    radio = "radio"
    checkbox = "checkbox"
    dropdown = "dropdown"
    linear_scale = "linear_scale"
    date = "date"
    time = "time"


class FormField(BaseModel):
    field_id: str  # "entry.XXXXX"
    label: str
    field_type: FieldType
    required: bool = False
    options: list[str] = []
    page_index: int = 0


class FormSchema(BaseModel):
    title: str
    description: str = ""
    fields: list[FormField]
    page_count: int = 1
    url: str = ""
    provider: str = ""
    scrape_warnings: list[str] = []


class FieldMapping(BaseModel):
    field_id: str
    field_label: str
    proposed_answer: str
    source_citation: str = ""
    confidence: str = "medium"  # "high", "medium", "low"
    reasoning: str = ""
    source_chunks: list[DocChunk] = []


class MappingResult(BaseModel):
    mappings: list[FieldMapping]
    unmapped_fields: list[str] = []
    doc_chunks: list[DocChunk] = []


class SessionMeta(BaseModel):
    id: str
    created_at: str
    document_filename: str
    form_url: str = ""
    form_title: str = ""
    form_provider: str = ""


class SessionFull(SessionMeta):
    form_schema: dict
    mapping_result: dict
    edited_mappings: list[dict] | None = None


class SessionCreate(BaseModel):
    document_filename: str
    form_url: str = ""
    form_title: str = ""
    form_provider: str = ""
    form_schema: dict
    mapping_result: dict


class SessionUpdateMappings(BaseModel):
    mappings: list[dict]


class KnowledgeProfileBase(BaseModel):
    user_context: str = Field(default="", max_length=20000)
    firm_context: str = Field(default="", max_length=20000)


class KnowledgeProfileUpdate(KnowledgeProfileBase):
    pass


class KnowledgeProfile(KnowledgeProfileBase):
    updated_at: str | None = None

    def has_content(self) -> bool:
        return bool(self.user_context.strip() or self.firm_context.strip())

