import { z } from "zod";

export const HearingModeEnum = z.enum([
  "full_memo",
  "watchlist",
  "pre_hearing",
  "hybrid",
]);
export type HearingMode = z.infer<typeof HearingModeEnum>;

export const HearingStatusEnum = z.enum([
  "created",
  "resolving",
  "metadata_resolved",
  "stream_resolved",
  "capturing",
  "transcribing",
  "finalizing",
  "analyzing",
  "ready_for_review",
  "exported",
  "failed",
]);
export type HearingStatus = z.infer<typeof HearingStatusEnum>;

export const HearingOutputTypeEnum = z.enum([
  "full_memo",
  "targeted_recap",
  "transcript",
  "pre_hearing_brief",
  "mention_log",
]);
export type HearingOutputType = z.infer<typeof HearingOutputTypeEnum>;

export const HearingExportFormatEnum = z.enum([
  "markdown",
  "html",
  "email",
  "csv",
  "json",
  "transcript",
  "docx",
  "pdf",
]);
export type HearingExportFormat = z.infer<typeof HearingExportFormatEnum>;

export const SpeakerTypeEnum = z.enum([
  "member",
  "witness",
  "chair",
  "staff",
  "unknown",
]);
export type SpeakerType = z.infer<typeof SpeakerTypeEnum>;

export const TranscriptSourceEnum = z.enum([
  "asr",
  "live_asr",
  "official_caption",
  "official_transcript",
  "manual",
]);
export type TranscriptSource = z.infer<typeof TranscriptSourceEnum>;

export const ReviewStatusEnum = z.enum([
  "unreviewed",
  "verified",
  "needs_review",
]);
export type ReviewStatus = z.infer<typeof ReviewStatusEnum>;

export const WatchItemTypeEnum = z.enum([
  "bill",
  "topic",
  "person",
  "organization",
  "phrase",
  "agency",
  "geography",
]);
export type WatchItemType = z.infer<typeof WatchItemTypeEnum>;

export const WatchMatchModeEnum = z.enum([
  "exact",
  "alias",
  "semantic",
  "hybrid",
]);
export type WatchMatchMode = z.infer<typeof WatchMatchModeEnum>;

export const WatchImportanceEnum = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);
export type WatchImportance = z.infer<typeof WatchImportanceEnum>;

export const WatchHitStatusEnum = z.enum([
  "new",
  "reviewed",
  "dismissed",
  "exported",
]);
export type WatchHitStatus = z.infer<typeof WatchHitStatusEnum>;

export const VerificationStatusEnum = z.enum([
  "supported",
  "weak_support",
  "unsupported",
  "needs_review",
]);
export type VerificationStatus = z.infer<typeof VerificationStatusEnum>;

export const HearingClientContextSchema = z.object({
  aliases: z.array(z.string()).default([]),
  tickers: z.array(z.string()).default([]),
  subsidiaries: z.array(z.string()).default([]),
  products: z.array(z.string()).default([]),
  competitors: z.array(z.string()).default([]),
  trade_associations: z.array(z.string()).default([]),
  industry_tags: z.array(z.string()).default([]),
  agencies: z.array(z.string()).default([]),
  committees: z.array(z.string()).default([]),
  priority_bills: z.array(z.string()).default([]),
  amendments: z.array(z.string()).default([]),
  regulations: z.array(z.string()).default([]),
  programs: z.array(z.string()).default([]),
  budget_accounts: z.array(z.string()).default([]),
  geographies: z.array(z.string()).default([]),
  facilities: z.array(z.string()).default([]),
  key_people: z.array(z.string()).default([]),
  care_about: z.string().default(""),
  ignore_unless_directly_mentioned: z.string().default(""),
  preferred_output_style: z
    .enum(["short_alert", "formal_memo", "detailed_transcript_recap"])
    .default("formal_memo"),
  confidential_internal_notes: z.string().default(""),
});
export type HearingClientContext = z.infer<typeof HearingClientContextSchema>;

export const HearingExternalSourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  source_type: z.string(),
  reliability_tier: z.number().int().min(1).max(4),
});
export type HearingExternalSource = z.infer<typeof HearingExternalSourceSchema>;

export const HearingWitnessSchema = z.object({
  name: z.string(),
  title: z.string().default(""),
  organization: z.string().default(""),
  statement_url: z.string().default(""),
});
export type HearingWitness = z.infer<typeof HearingWitnessSchema>;

export const HearingStreamCandidateSchema = z.object({
  url: z.string(),
  provider: z.string(),
  label: z.string().default(""),
  confidence: z.number().min(0).max(1),
  source: z.enum(["video", "iframe", "link", "metadata"]),
  official: z.boolean().default(false),
});
export type HearingStreamCandidate = z.infer<typeof HearingStreamCandidateSchema>;

export const HearingResolvedMetadataSchema = z.object({
  source_url: z.string(),
  source_type: z.string(),
  source_reliability_tier: z.number().int().min(1).max(4),
  hearing_title: z.string(),
  chamber: z.string(),
  committee: z.string(),
  subcommittee: z.string().default(""),
  hearing_datetime: z.string().nullable().default(null),
  live_status: z.enum(["live", "archived", "scheduled", "unknown"]).default("unknown"),
  witnesses: z.array(HearingWitnessSchema).default([]),
  documents: z.array(HearingExternalSourceSchema).default([]),
  media_url: z.string().default(""),
  captions_url: z.string().default(""),
  transcript_url: z.string().default(""),
  stream_url: z.string().default(""),
  stream_provider: z.string().default(""),
  stream_confidence: z.number().min(0).max(1).default(0),
  stream_candidates: z.array(HearingStreamCandidateSchema).default([]),
  warnings: z.array(z.string()).default([]),
  bill_references: z.array(z.string()).default([]),
});
export type HearingResolvedMetadata = z.infer<typeof HearingResolvedMetadataSchema>;

export const HearingJobSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  client_id: z.string(),
  client_name: z.string(),
  matter_id: z.string().nullable().default(null),
  created_by_user_id: z.string(),
  source_url: z.string(),
  source_type: z.string().default("unknown"),
  source_reliability_tier: z.number().int().min(1).max(4).default(4),
  mode: HearingModeEnum,
  status: HearingStatusEnum,
  hearing_title: z.string().default(""),
  chamber: z.string().default(""),
  committee: z.string().default(""),
  subcommittee: z.string().default(""),
  hearing_datetime: z.string().nullable().default(null),
  witnesses: z.array(HearingWitnessSchema).default([]),
  metadata: z.record(z.unknown()).default({}),
  stream_url: z.string().default(""),
  stream_provider: z.string().default(""),
  stream_confidence: z.number().min(0).max(1).default(0),
  capture_status: z
    .enum(["idle", "resolved", "starting", "running", "stopping", "stopped", "finalized", "failed"])
    .default("idle"),
  capture_started_at: z.string().nullable().default(null),
  capture_stopped_at: z.string().nullable().default(null),
  audio_chunk_count: z.number().int().nonnegative().default(0),
  transcription_status: z
    .enum(["idle", "waiting", "transcribing", "complete", "failed"])
    .default("idle"),
  capture_error: z.string().default(""),
  client_context: HearingClientContextSchema.default({}),
  error_message: z.string().default(""),
  created_at: z.string(),
  updated_at: z.string(),
});
export type HearingJob = z.infer<typeof HearingJobSchema>;

export const HearingTranscriptSegmentSchema = z.object({
  segmentId: z.string(),
  hearingJobId: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  speakerLabel: z.string(),
  speakerType: SpeakerTypeEnum,
  text: z.string(),
  asrConfidence: z.number().min(0).max(1),
  speakerConfidence: z.number().min(0).max(1),
  source: TranscriptSourceEnum,
  reviewStatus: ReviewStatusEnum,
});
export type HearingTranscriptSegment = z.infer<typeof HearingTranscriptSegmentSchema>;

export const HearingWatchItemSchema = z.object({
  id: z.string(),
  hearing_job_id: z.string(),
  type: WatchItemTypeEnum,
  label: z.string(),
  aliases: z.array(z.string()).default([]),
  match_mode: WatchMatchModeEnum,
  importance: WatchImportanceEnum,
  negative_filters: z.array(z.string()).default([]),
});
export type HearingWatchItem = z.infer<typeof HearingWatchItemSchema>;

export const HearingWatchItemDraftSchema = z.object({
  id: z.string().optional(),
  type: WatchItemTypeEnum.default("topic"),
  label: z.string(),
  aliases: z.array(z.string()).default([]),
  match_mode: WatchMatchModeEnum.default("hybrid"),
  importance: WatchImportanceEnum.default("medium"),
  negative_filters: z.array(z.string()).default([]),
});
export type HearingWatchItemDraft = z.infer<typeof HearingWatchItemDraftSchema>;

export const HearingWatchHitSchema = z.object({
  hitId: z.string(),
  watchItemId: z.string(),
  hearingJobId: z.string(),
  triggerText: z.string(),
  matchType: z.enum(["exact", "alias", "bill_normalized", "semantic"]),
  confidence: z.number().min(0).max(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  speakerLabels: z.array(z.string()).default([]),
  transcriptSegmentIds: z.array(z.string()).default([]),
  clientRelevance: z.string(),
  status: WatchHitStatusEnum,
});
export type HearingWatchHit = z.infer<typeof HearingWatchHitSchema>;

export const HearingClaimSchema = z.object({
  id: z.string(),
  hearing_output_id: z.string(),
  claim_text: z.string(),
  supporting_segment_ids: z.array(z.string()).default([]),
  supporting_external_sources: z.array(HearingExternalSourceSchema).default([]),
  confidence: z.number().min(0).max(1),
  verification_status: VerificationStatusEnum,
});
export type HearingClaim = z.infer<typeof HearingClaimSchema>;

export const HearingOutputSchema = z.object({
  id: z.string(),
  hearing_job_id: z.string(),
  type: HearingOutputTypeEnum,
  content_json: z.record(z.unknown()).default({}),
  content_markdown: z.string(),
  review_status: ReviewStatusEnum,
  model_metadata: z.record(z.unknown()).default({}),
  created_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type HearingOutput = z.infer<typeof HearingOutputSchema>;

export const HearingCommentSchema = z.object({
  id: z.string(),
  hearing_job_id: z.string(),
  target_type: z.enum(["job", "segment", "hit", "claim", "output"]),
  target_id: z.string(),
  comment: z.string(),
  created_by: z.string(),
  created_at: z.string(),
});
export type HearingComment = z.infer<typeof HearingCommentSchema>;

export const HearingWorkspaceSchema = z.object({
  job: HearingJobSchema,
  transcript_segments: z.array(HearingTranscriptSegmentSchema),
  watch_items: z.array(HearingWatchItemSchema),
  watch_hits: z.array(HearingWatchHitSchema),
  outputs: z.array(HearingOutputSchema),
  claims: z.array(HearingClaimSchema),
  comments: z.array(HearingCommentSchema),
});
export type HearingWorkspace = z.infer<typeof HearingWorkspaceSchema>;

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

export interface HearingCreateInput {
  client_id: string;
  client_name?: string;
  matter_id?: string | null;
  source_url: string;
  mode: HearingMode;
  client_context?: Partial<HearingClientContext>;
  watch_items?: HearingWatchItemDraft[];
}

export interface HearingExportResult {
  buffer: ArrayBuffer;
  filename: string;
  mime_type: string;
}
