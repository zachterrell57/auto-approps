export interface DocChunk {
  text: string;
  source_location: string;
  chunk_type: string;
  heading_context: string;
  heading_level: number;
  index: number;
}

export interface ParsedDocument {
  filename: string;
  chunks: DocChunk[];
  full_text: string;
}

export type FieldType =
  | "short_text"
  | "long_text"
  | "radio"
  | "checkbox"
  | "dropdown"
  | "linear_scale"
  | "date"
  | "time";

export interface FormField {
  field_id: string;
  label: string;
  field_type: FieldType;
  required: boolean;
  options: string[];
  page_index: number;
}

export interface FormSchema {
  title: string;
  description: string;
  fields: FormField[];
  page_count: number;
  url: string;
  provider: string;
  scrape_warnings: string[];
}

export interface FieldMapping {
  field_id: string;
  field_label: string;
  proposed_answer: string;
  source_citation: string;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  skip: boolean;
  source_chunks: DocChunk[];
}

export interface MappingResult {
  mappings: FieldMapping[];
  unmapped_fields: string[];
  doc_chunks: DocChunk[];
}

export interface UploadResponse {
  filename: string;
  chunk_count: number;
  preview: string;
}

export interface KnowledgeProfile {
  user_context: string;
  firm_context: string;
  updated_at: string | null;
}

export interface KnowledgeProfileUpdate {
  user_context: string;
  firm_context: string;
}

export interface AppSettings {
  anthropic_api_key_set: boolean;
  anthropic_api_key_preview: string;
}

export interface SettingsUpdate {
  anthropic_api_key: string;
}
