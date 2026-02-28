from __future__ import annotations

from enum import Enum

from pydantic import BaseModel


class DocChunk(BaseModel):
    text: str
    source_location: str
    chunk_type: str  # "paragraph", "table_row", "heading"
    heading_context: str = ""
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
    skip: bool = False
    source_chunks: list[DocChunk] = []


class MappingResult(BaseModel):
    mappings: list[FieldMapping]
    unmapped_fields: list[str] = []
    doc_chunks: list[DocChunk] = []
