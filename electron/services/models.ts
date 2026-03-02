import { z } from "zod";

// ---------------------------------------------------------------------------
// DocChunk
// ---------------------------------------------------------------------------

export const DocChunkSchema = z.object({
  text: z.string(),
  source_location: z.string(),
  chunk_type: z.string(), // "paragraph" | "table_row" | "heading"
  heading_context: z.string().default(""),
  heading_level: z.number().int().default(0),
  index: z.number().int().default(0),
});

export type DocChunk = z.infer<typeof DocChunkSchema>;

// ---------------------------------------------------------------------------
// ParsedDocument
// ---------------------------------------------------------------------------

export const ParsedDocumentSchema = z.object({
  filename: z.string(),
  chunks: z.array(DocChunkSchema),
  full_text: z.string(),
});

export type ParsedDocument = z.infer<typeof ParsedDocumentSchema>;

// ---------------------------------------------------------------------------
// FieldType
// ---------------------------------------------------------------------------

export const FieldTypeEnum = z.enum([
  "short_text",
  "long_text",
  "radio",
  "checkbox",
  "dropdown",
  "linear_scale",
  "date",
  "time",
]);

export type FieldType = z.infer<typeof FieldTypeEnum>;

// ---------------------------------------------------------------------------
// FormField
// ---------------------------------------------------------------------------

export const FormFieldSchema = z.object({
  field_id: z.string(),
  label: z.string(),
  field_type: FieldTypeEnum,
  required: z.boolean().default(false),
  options: z.array(z.string()).default([]),
  page_index: z.number().int().default(0),
});

export type FormField = z.infer<typeof FormFieldSchema>;

// ---------------------------------------------------------------------------
// FormSchema
// ---------------------------------------------------------------------------

export const FormSchemaSchema = z.object({
  title: z.string(),
  description: z.string().default(""),
  fields: z.array(FormFieldSchema),
  page_count: z.number().int().default(1),
  url: z.string().default(""),
  provider: z.string().default(""),
  scrape_warnings: z.array(z.string()).default([]),
});

export type FormSchema = z.infer<typeof FormSchemaSchema>;

// ---------------------------------------------------------------------------
// FieldMapping
// ---------------------------------------------------------------------------

export const FieldMappingSchema = z.object({
  field_id: z.string(),
  field_label: z.string(),
  proposed_answer: z.string(),
  source_citation: z.string().default(""),
  confidence: z.string().default("medium"),
  reasoning: z.string().default(""),
  source_chunks: z.array(DocChunkSchema).default([]),
});

export type FieldMapping = z.infer<typeof FieldMappingSchema>;

// ---------------------------------------------------------------------------
// MappingResult
// ---------------------------------------------------------------------------

export const MappingResultSchema = z.object({
  mappings: z.array(FieldMappingSchema),
  unmapped_fields: z.array(z.string()).default([]),
  doc_chunks: z.array(DocChunkSchema).default([]),
});

export type MappingResult = z.infer<typeof MappingResultSchema>;

// ---------------------------------------------------------------------------
// SessionMeta
// ---------------------------------------------------------------------------

export const SessionMetaSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  document_filename: z.string().nullable().default(null),
  form_url: z.string().default(""),
  form_title: z.string().default(""),
  form_provider: z.string().default(""),
  display_name: z.string().default(""),
});

export type SessionMeta = z.infer<typeof SessionMetaSchema>;

// ---------------------------------------------------------------------------
// SessionFull (extends SessionMeta)
// ---------------------------------------------------------------------------

export const SessionFullSchema = SessionMetaSchema.extend({
  form_schema: z.record(z.unknown()),
  mapping_result: z.record(z.unknown()),
  edited_mappings: z.array(z.record(z.unknown())).nullable().default(null),
});

export type SessionFull = z.infer<typeof SessionFullSchema>;

// ---------------------------------------------------------------------------
// SessionCreate
// ---------------------------------------------------------------------------

export const SessionCreateSchema = z.object({
  document_filename: z.string().nullable().default(null),
  form_url: z.string().default(""),
  form_title: z.string().default(""),
  form_provider: z.string().default(""),
  form_schema: z.record(z.unknown()),
  mapping_result: z.record(z.unknown()),
});

export type SessionCreate = z.infer<typeof SessionCreateSchema>;

// ---------------------------------------------------------------------------
// SessionUpdateMappings
// ---------------------------------------------------------------------------

export const SessionUpdateMappingsSchema = z.object({
  mappings: z.array(z.record(z.unknown())),
});

export type SessionUpdateMappings = z.infer<typeof SessionUpdateMappingsSchema>;

// ---------------------------------------------------------------------------
// KnowledgeProfileBase
// ---------------------------------------------------------------------------

export const KnowledgeProfileBaseSchema = z.object({
  user_context: z.string().max(20000).default(""),
  firm_context: z.string().max(20000).default(""),
});

export type KnowledgeProfileBase = z.infer<typeof KnowledgeProfileBaseSchema>;

// ---------------------------------------------------------------------------
// KnowledgeProfileUpdate
// ---------------------------------------------------------------------------

export const KnowledgeProfileUpdateSchema = KnowledgeProfileBaseSchema;

export type KnowledgeProfileUpdate = z.infer<
  typeof KnowledgeProfileUpdateSchema
>;

// ---------------------------------------------------------------------------
// KnowledgeProfile
// ---------------------------------------------------------------------------

export const KnowledgeProfileSchema = KnowledgeProfileBaseSchema.extend({
  updated_at: z.string().nullable().default(null),
});

export type KnowledgeProfile = z.infer<typeof KnowledgeProfileSchema>;

export function knowledgeProfileHasContent(profile: KnowledgeProfile): boolean {
  return !!(profile.user_context.trim() || profile.firm_context.trim());
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export const ClientCreateSchema = z.object({
  name: z.string().max(255),
  knowledge: z.string().max(20000).default(""),
});

export type ClientCreate = z.infer<typeof ClientCreateSchema>;

export const ClientUpdateSchema = z.object({
  name: z.string().max(255).optional(),
  knowledge: z.string().max(20000).optional(),
});

export type ClientUpdate = z.infer<typeof ClientUpdateSchema>;

export const ClientSchema = z.object({
  id: z.string(),
  name: z.string(),
  knowledge: z.string().default(""),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Client = z.infer<typeof ClientSchema>;

// ---------------------------------------------------------------------------
// AppSettings (referenced by IPC channels)
// ---------------------------------------------------------------------------

export const AppSettingsSchema = z.object({
  anthropic_api_key: z.string().default(""),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

// ---------------------------------------------------------------------------
// UploadResponse (returned by the upload channel)
// ---------------------------------------------------------------------------

export const UploadResponseSchema = z.object({
  filename: z.string(),
  chunk_count: z.number().int(),
  preview: z.string(),
});

export type UploadResponse = z.infer<typeof UploadResponseSchema>;
