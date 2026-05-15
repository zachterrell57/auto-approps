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
  openai_api_key_set: boolean;
  openai_api_key_preview: string;
  yt_dlp_available: boolean;
  yt_dlp_version: string;
  yt_dlp_path: string;
  yt_dlp_source: string;
  yt_dlp_error: string;
  ffmpeg_available: boolean;
  ffmpeg_version: string;
  ffmpeg_path: string;
  ffmpeg_source: string;
  ffmpeg_error: string;
}

export interface SettingsUpdate {
  anthropic_api_key?: string;
  openai_api_key?: string;
}

// ── Hearing Intelligence ───────────────────────────────────────────────
export type HearingMode = "full_memo" | "watchlist" | "pre_hearing" | "hybrid";

export type HearingStatus =
  | "created"
  | "resolving"
  | "metadata_resolved"
  | "stream_resolved"
  | "capturing"
  | "transcribing"
  | "finalizing"
  | "analyzing"
  | "ready_for_review"
  | "exported"
  | "failed";

export type HearingOutputType =
  | "full_memo"
  | "targeted_recap"
  | "transcript"
  | "pre_hearing_brief"
  | "mention_log";

export type HearingExportFormat =
  | "markdown"
  | "html"
  | "email"
  | "csv"
  | "json"
  | "transcript"
  | "docx"
  | "pdf";

export type HearingReviewStatus = "unreviewed" | "verified" | "needs_review";
export type HearingVerificationStatus =
  | "supported"
  | "weak_support"
  | "unsupported"
  | "needs_review";

export interface HearingClientContext {
  aliases: string[];
  tickers: string[];
  subsidiaries: string[];
  products: string[];
  competitors: string[];
  trade_associations: string[];
  industry_tags: string[];
  agencies: string[];
  committees: string[];
  priority_bills: string[];
  amendments: string[];
  regulations: string[];
  programs: string[];
  budget_accounts: string[];
  geographies: string[];
  facilities: string[];
  key_people: string[];
  care_about: string;
  ignore_unless_directly_mentioned: string;
  preferred_output_style:
    | "short_alert"
    | "formal_memo"
    | "detailed_transcript_recap";
  confidential_internal_notes: string;
}

export interface HearingWitness {
  name: string;
  title: string;
  organization: string;
  statement_url: string;
}

export interface HearingYoutubeSource {
  video_id: string;
  url: string;
  embed_url: string;
  title: string;
  channel: string;
  duration_seconds: number | null;
  live_status: "live" | "recorded" | "scheduled" | "unavailable" | "unknown";
  resolved_from: string;
  validated_at: string | null;
  probe_error: string;
}

export interface HearingJob {
  id: string;
  org_id: string;
  client_id: string;
  client_name: string;
  matter_id: string | null;
  created_by_user_id: string;
  source_url: string;
  source_type: string;
  source_reliability_tier: number;
  mode: HearingMode;
  status: HearingStatus;
  hearing_title: string;
  chamber: string;
  committee: string;
  subcommittee: string;
  hearing_datetime: string | null;
  witnesses: HearingWitness[];
  metadata: Record<string, unknown> & { youtube_source?: HearingYoutubeSource | null };
  stream_url: string;
  stream_provider: string;
  stream_confidence: number;
  capture_status:
    | "idle"
    | "resolved"
    | "starting"
    | "running"
    | "stopping"
    | "stopped"
    | "finalized"
    | "failed";
  capture_started_at: string | null;
  capture_stopped_at: string | null;
  audio_chunk_count: number;
  transcription_status: "idle" | "waiting" | "transcribing" | "complete" | "failed";
  capture_error: string;
  client_context: HearingClientContext;
  error_message: string;
  created_at: string;
  updated_at: string;
}

export interface HearingJobSummary {
  id: string;
  client_id: string;
  client_name: string;
  mode: HearingMode;
  status: HearingStatus;
  hearing_title: string;
  committee: string;
  hearing_datetime: string | null;
  source_url: string;
  stream_url: string;
  stream_provider: string;
  capture_status: HearingJob["capture_status"];
  transcription_status: HearingJob["transcription_status"];
  updated_at: string;
  transcript_segment_count: number;
  watch_hit_count: number;
  output_count: number;
}

export interface HearingTranscriptSegment {
  segmentId: string;
  hearingJobId: string;
  startMs: number;
  endMs: number;
  speakerLabel: string;
  speakerType: "member" | "witness" | "chair" | "staff" | "unknown";
  text: string;
  asrConfidence: number;
  speakerConfidence: number;
  source: "asr" | "live_asr" | "official_caption" | "official_transcript" | "manual";
  reviewStatus: HearingReviewStatus;
}

export interface HearingWatchItem {
  id: string;
  hearing_job_id: string;
  type:
    | "bill"
    | "topic"
    | "person"
    | "organization"
    | "phrase"
    | "agency"
    | "geography";
  label: string;
  aliases: string[];
  match_mode: "exact" | "alias" | "semantic" | "hybrid";
  importance: "low" | "medium" | "high" | "critical";
  negative_filters: string[];
}

export interface HearingWatchItemDraft extends Omit<HearingWatchItem, "id" | "hearing_job_id"> {
  id?: string;
}

export interface HearingWatchHit {
  hitId: string;
  watchItemId: string;
  hearingJobId: string;
  triggerText: string;
  matchType: "exact" | "alias" | "bill_normalized" | "semantic";
  confidence: number;
  startMs: number;
  endMs: number;
  speakerLabels: string[];
  transcriptSegmentIds: string[];
  clientRelevance: string;
  status: "new" | "reviewed" | "dismissed" | "exported";
}

export interface HearingOutput {
  id: string;
  hearing_job_id: string;
  type: HearingOutputType;
  content_json: Record<string, unknown>;
  content_markdown: string;
  review_status: HearingReviewStatus;
  model_metadata: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface HearingClaim {
  id: string;
  hearing_output_id: string;
  claim_text: string;
  supporting_segment_ids: string[];
  supporting_external_sources: Array<{
    title: string;
    url: string;
    source_type: string;
    reliability_tier: number;
  }>;
  confidence: number;
  verification_status: HearingVerificationStatus;
}

export interface HearingComment {
  id: string;
  hearing_job_id: string;
  target_type: "job" | "segment" | "hit" | "claim" | "output";
  target_id: string;
  comment: string;
  created_by: string;
  created_at: string;
}

export interface HearingWorkspace {
  job: HearingJob;
  transcript_segments: HearingTranscriptSegment[];
  watch_items: HearingWatchItem[];
  watch_hits: HearingWatchHit[];
  outputs: HearingOutput[];
  claims: HearingClaim[];
  comments: HearingComment[];
}

export interface HearingCreateInput {
  client_id?: string;
  client_name?: string;
  matter_id?: string | null;
  source_url: string;
  mode: HearingMode;
  client_context?: Partial<HearingClientContext>;
  watch_items?: HearingWatchItemDraft[];
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
