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

export type TargetKind =
  | "web_form"
  | "docx_questionnaire"
  | "pdf_questionnaire";

export interface FormField {
  field_id: string;
  label: string;
  field_type: FieldType;
  required: boolean;
  options: string[];
  page_index: number;
  target_locator?: Record<string, unknown> | null;
  exportable: boolean;
  export_issue: string;
}

export interface FormSchema {
  title: string;
  description: string;
  fields: FormField[];
  page_count: number;
  target_kind: TargetKind;
  target_url: string;
  target_filename: string | null;
  target_title: string;
  target_provider: string;
  parse_warnings: string[];
  url: string;
  provider: string;
  scrape_warnings: string[];
  form_state?: string;
  form_state_message?: string;
}

export type TargetSchema = FormSchema;

export interface FieldMapping {
  field_id: string;
  field_label: string;
  proposed_answer: string;
  source_citation: string;
  confidence: "high" | "medium" | "low";
  reasoning: string;
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

export interface SessionMeta {
  id: string;
  created_at: string;
  last_updated_at: string;
  source_document_filename: string | null;
  target_kind: TargetKind;
  target_url: string;
  target_filename: string | null;
  target_title: string;
  target_provider: string;
  display_name?: string;
}

export interface SessionFull extends SessionMeta {
  target_schema: TargetSchema;
  mapping_result: MappingResult;
  edited_mappings: FieldMapping[] | null;
}

export interface SavedForm {
  target_kind: TargetKind;
  target_url: string;
  target_filename: string | null;
  target_title: string;
  display_name: string;
}

export interface Client {
  id: string;
  name: string;
  knowledge: string;
  created_at: string;
  updated_at: string;
}

export interface ClientCreate {
  name: string;
  knowledge?: string;
}

export interface ClientUpdate {
  name?: string;
  knowledge?: string;
}

export interface AppSettings {
  anthropic_api_key_set: boolean;
  anthropic_api_key_preview: string;
}

export interface SettingsUpdate {
  anthropic_api_key: string;
}

// ── Auto-update ────────────────────────────────────────────────────────
export type UpdateStatusType =
  | "checking"
  | "available"
  | "downloaded"
  | "not-available"
  | "error";

export interface UpdateStatus {
  status: UpdateStatusType;
  releaseName?: string;
  error?: string;
}
