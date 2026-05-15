import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

import { getUserDataPath } from "./config";
import {
  HearingClaimSchema,
  HearingClientContextSchema,
  HearingCommentSchema,
  HearingJobSchema,
  HearingModeEnum,
  HearingOutputSchema,
  HearingOutputTypeEnum,
  HearingStatusEnum,
  HearingTranscriptSegmentSchema,
  HearingWatchHitSchema,
  HearingWatchItemDraftSchema,
  HearingWatchItemSchema,
  ReviewStatusEnum,
  TranscriptSourceEnum,
  WatchHitStatusEnum,
  type HearingClaim,
  type HearingComment,
  type HearingCreateInput,
  type HearingJob,
  type HearingJobSummary,
  type HearingOutput,
  type HearingOutputType,
  type HearingResolvedMetadata,
  type HearingTranscriptSegment,
  type HearingWatchHit,
  type HearingWatchItem,
  type HearingWatchItemDraft,
  type HearingWorkspace,
  type ReviewStatus,
  type VerificationStatus,
  type WatchHitStatus,
} from "./hearing-models";

const LOCAL_ORG_ID = "local-org";
const LOCAL_USER_ID = "local-user";

let db: BetterSqlite3.Database | null = null;

function ensureColumn(
  conn: BetterSqlite3.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = conn.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (columns.some((entry) => entry.name === column)) return;
  conn.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}

function getDbPath(): string {
  return path.join(getUserDataPath(), "sessions.db");
}

function jsonString(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function getDb(): BetterSqlite3.Database {
  if (db) return db;

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const conn = new Database(dbPath);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");

  conn.exec(`
    CREATE TABLE IF NOT EXISTS hearing_jobs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_name TEXT NOT NULL,
      matter_id TEXT,
      created_by_user_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'unknown',
      source_reliability_tier INTEGER NOT NULL DEFAULT 4,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      hearing_title TEXT NOT NULL DEFAULT '',
      chamber TEXT NOT NULL DEFAULT '',
      committee TEXT NOT NULL DEFAULT '',
      subcommittee TEXT NOT NULL DEFAULT '',
      hearing_datetime TEXT,
      witnesses_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      stream_url TEXT NOT NULL DEFAULT '',
      stream_provider TEXT NOT NULL DEFAULT '',
      stream_confidence REAL NOT NULL DEFAULT 0,
      capture_status TEXT NOT NULL DEFAULT 'idle',
      capture_started_at TEXT,
      capture_stopped_at TEXT,
      audio_chunk_count INTEGER NOT NULL DEFAULT 0,
      transcription_status TEXT NOT NULL DEFAULT 'idle',
      capture_error TEXT NOT NULL DEFAULT '',
      client_context_json TEXT NOT NULL DEFAULT '{}',
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hearing_transcript_segments (
      id TEXT PRIMARY KEY,
      hearing_job_id TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      speaker_label TEXT NOT NULL,
      speaker_type TEXT NOT NULL,
      speaker_confidence REAL NOT NULL,
      text TEXT NOT NULL,
      asr_confidence REAL NOT NULL,
      source TEXT NOT NULL,
      review_status TEXT NOT NULL,
      FOREIGN KEY (hearing_job_id) REFERENCES hearing_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS hearing_watch_items (
      id TEXT PRIMARY KEY,
      hearing_job_id TEXT NOT NULL,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      match_mode TEXT NOT NULL,
      importance TEXT NOT NULL,
      negative_filters_json TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (hearing_job_id) REFERENCES hearing_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS hearing_watch_hits (
      id TEXT PRIMARY KEY,
      watch_item_id TEXT NOT NULL,
      hearing_job_id TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      trigger_text TEXT NOT NULL,
      match_type TEXT NOT NULL,
      confidence REAL NOT NULL,
      speaker_labels_json TEXT NOT NULL DEFAULT '[]',
      segment_ids_json TEXT NOT NULL DEFAULT '[]',
      client_relevance TEXT NOT NULL,
      status TEXT NOT NULL,
      FOREIGN KEY (watch_item_id) REFERENCES hearing_watch_items(id) ON DELETE CASCADE,
      FOREIGN KEY (hearing_job_id) REFERENCES hearing_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS hearing_outputs (
      id TEXT PRIMARY KEY,
      hearing_job_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content_json TEXT NOT NULL DEFAULT '{}',
      content_markdown TEXT NOT NULL,
      review_status TEXT NOT NULL,
      model_metadata_json TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (hearing_job_id) REFERENCES hearing_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS hearing_claims (
      id TEXT PRIMARY KEY,
      hearing_output_id TEXT NOT NULL,
      claim_text TEXT NOT NULL,
      supporting_segment_ids_json TEXT NOT NULL DEFAULT '[]',
      supporting_external_sources_json TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL,
      verification_status TEXT NOT NULL,
      FOREIGN KEY (hearing_output_id) REFERENCES hearing_outputs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS hearing_comments (
      id TEXT PRIMARY KEY,
      hearing_job_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      comment TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (hearing_job_id) REFERENCES hearing_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS hearing_audit_events (
      id TEXT PRIMARY KEY,
      hearing_job_id TEXT,
      event_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hearing_congressional_cache (
      cache_key TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      value_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_hearing_jobs_updated_at
      ON hearing_jobs(updated_at);
    CREATE INDEX IF NOT EXISTS idx_hearing_segments_job_start
      ON hearing_transcript_segments(hearing_job_id, start_ms);
    CREATE INDEX IF NOT EXISTS idx_hearing_hits_job_start
      ON hearing_watch_hits(hearing_job_id, start_ms);
    CREATE INDEX IF NOT EXISTS idx_hearing_outputs_job
      ON hearing_outputs(hearing_job_id, created_at);
  `);

  ensureColumn(conn, "hearing_jobs", "stream_url", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(conn, "hearing_jobs", "stream_provider", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(conn, "hearing_jobs", "stream_confidence", "REAL NOT NULL DEFAULT 0");
  ensureColumn(conn, "hearing_jobs", "capture_status", "TEXT NOT NULL DEFAULT 'idle'");
  ensureColumn(conn, "hearing_jobs", "capture_started_at", "TEXT");
  ensureColumn(conn, "hearing_jobs", "capture_stopped_at", "TEXT");
  ensureColumn(conn, "hearing_jobs", "audio_chunk_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(conn, "hearing_jobs", "transcription_status", "TEXT NOT NULL DEFAULT 'idle'");
  ensureColumn(conn, "hearing_jobs", "capture_error", "TEXT NOT NULL DEFAULT ''");

  db = conn;
  return conn;
}

function audit(
  hearingJobId: string | null,
  eventType: string,
  metadata: Record<string, unknown> = {},
): void {
  const conn = getDb();
  conn
    .prepare(
      `INSERT INTO hearing_audit_events
       (id, hearing_job_id, event_type, actor_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      uuidv4(),
      hearingJobId,
      eventType,
      LOCAL_USER_ID,
      jsonString(metadata),
      new Date().toISOString(),
    );
}

function rowToJob(row: Record<string, unknown>): HearingJob {
  return HearingJobSchema.parse({
    id: row.id,
    org_id: row.org_id,
    client_id: row.client_id,
    client_name: row.client_name,
    matter_id: row.matter_id ?? null,
    created_by_user_id: row.created_by_user_id,
    source_url: row.source_url,
    source_type: row.source_type,
    source_reliability_tier: row.source_reliability_tier,
    mode: row.mode,
    status: row.status,
    hearing_title: row.hearing_title,
    chamber: row.chamber,
    committee: row.committee,
    subcommittee: row.subcommittee,
    hearing_datetime: row.hearing_datetime ?? null,
    witnesses: parseJson(String(row.witnesses_json ?? "[]"), []),
    metadata: parseJson(String(row.metadata_json ?? "{}"), {}),
    stream_url: row.stream_url ?? "",
    stream_provider: row.stream_provider ?? "",
    stream_confidence: row.stream_confidence ?? 0,
    capture_status: row.capture_status ?? "idle",
    capture_started_at: row.capture_started_at ?? null,
    capture_stopped_at: row.capture_stopped_at ?? null,
    audio_chunk_count: row.audio_chunk_count ?? 0,
    transcription_status: row.transcription_status ?? "idle",
    capture_error: row.capture_error ?? "",
    client_context: parseJson(String(row.client_context_json ?? "{}"), {}),
    error_message: row.error_message,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

function rowToSegment(row: Record<string, unknown>): HearingTranscriptSegment {
  return HearingTranscriptSegmentSchema.parse({
    segmentId: row.id,
    hearingJobId: row.hearing_job_id,
    startMs: row.start_ms,
    endMs: row.end_ms,
    speakerLabel: row.speaker_label,
    speakerType: row.speaker_type,
    speakerConfidence: row.speaker_confidence,
    text: row.text,
    asrConfidence: row.asr_confidence,
    source: row.source,
    reviewStatus: row.review_status,
  });
}

function rowToWatchItem(row: Record<string, unknown>): HearingWatchItem {
  return HearingWatchItemSchema.parse({
    id: row.id,
    hearing_job_id: row.hearing_job_id,
    type: row.type,
    label: row.label,
    aliases: parseJson(String(row.aliases_json ?? "[]"), []),
    match_mode: row.match_mode,
    importance: row.importance,
    negative_filters: parseJson(String(row.negative_filters_json ?? "[]"), []),
  });
}

function rowToHit(row: Record<string, unknown>): HearingWatchHit {
  return HearingWatchHitSchema.parse({
    hitId: row.id,
    watchItemId: row.watch_item_id,
    hearingJobId: row.hearing_job_id,
    startMs: row.start_ms,
    endMs: row.end_ms,
    triggerText: row.trigger_text,
    matchType: row.match_type,
    confidence: row.confidence,
    speakerLabels: parseJson(String(row.speaker_labels_json ?? "[]"), []),
    transcriptSegmentIds: parseJson(String(row.segment_ids_json ?? "[]"), []),
    clientRelevance: row.client_relevance,
    status: row.status,
  });
}

function rowToOutput(row: Record<string, unknown>): HearingOutput {
  return HearingOutputSchema.parse({
    id: row.id,
    hearing_job_id: row.hearing_job_id,
    type: row.type,
    content_json: parseJson(String(row.content_json ?? "{}"), {}),
    content_markdown: row.content_markdown,
    review_status: row.review_status,
    model_metadata: parseJson(String(row.model_metadata_json ?? "{}"), {}),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

function rowToClaim(row: Record<string, unknown>): HearingClaim {
  return HearingClaimSchema.parse({
    id: row.id,
    hearing_output_id: row.hearing_output_id,
    claim_text: row.claim_text,
    supporting_segment_ids: parseJson(
      String(row.supporting_segment_ids_json ?? "[]"),
      [],
    ),
    supporting_external_sources: parseJson(
      String(row.supporting_external_sources_json ?? "[]"),
      [],
    ),
    confidence: row.confidence,
    verification_status: row.verification_status,
  });
}

function rowToComment(row: Record<string, unknown>): HearingComment {
  return HearingCommentSchema.parse({
    id: row.id,
    hearing_job_id: row.hearing_job_id,
    target_type: row.target_type,
    target_id: row.target_id,
    comment: row.comment,
    created_by: row.created_by,
    created_at: row.created_at,
  });
}

export function createHearingJob(input: HearingCreateInput): HearingJob {
  const parsedMode = HearingModeEnum.parse(input.mode);
  const context = HearingClientContextSchema.parse(input.client_context ?? {});
  const now = new Date().toISOString();
  const job: HearingJob = {
    id: uuidv4(),
    org_id: LOCAL_ORG_ID,
    client_id: input.client_id,
    client_name: input.client_name ?? "Client",
    matter_id: input.matter_id ?? null,
    created_by_user_id: LOCAL_USER_ID,
    source_url: input.source_url.trim(),
    source_type: "unknown",
    source_reliability_tier: 4,
    mode: parsedMode,
    status: "created",
    hearing_title: "",
    chamber: "",
    committee: "",
    subcommittee: "",
    hearing_datetime: null,
    witnesses: [],
    metadata: {},
    stream_url: "",
    stream_provider: "",
    stream_confidence: 0,
    capture_status: "idle",
    capture_started_at: null,
    capture_stopped_at: null,
    audio_chunk_count: 0,
    transcription_status: "idle",
    capture_error: "",
    client_context: context,
    error_message: "",
    created_at: now,
    updated_at: now,
  };

  const conn = getDb();
  conn
    .prepare(
      `INSERT INTO hearing_jobs
       (id, org_id, client_id, client_name, matter_id, created_by_user_id,
        source_url, source_type, source_reliability_tier, mode, status,
        hearing_title, chamber, committee, subcommittee, hearing_datetime,
        witnesses_json, metadata_json, stream_url, stream_provider, stream_confidence,
        capture_status, capture_started_at, capture_stopped_at, audio_chunk_count,
        transcription_status, capture_error, client_context_json, error_message,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      job.id,
      job.org_id,
      job.client_id,
      job.client_name,
      job.matter_id,
      job.created_by_user_id,
      job.source_url,
      job.source_type,
      job.source_reliability_tier,
      job.mode,
      job.status,
      job.hearing_title,
      job.chamber,
      job.committee,
      job.subcommittee,
      job.hearing_datetime,
      jsonString(job.witnesses),
      jsonString(job.metadata),
      job.stream_url,
      job.stream_provider,
      job.stream_confidence,
      job.capture_status,
      job.capture_started_at,
      job.capture_stopped_at,
      job.audio_chunk_count,
      job.transcription_status,
      job.capture_error,
      jsonString(job.client_context),
      job.error_message,
      job.created_at,
      job.updated_at,
    );

  if (input.watch_items?.length) {
    replaceWatchItems(job.id, input.watch_items);
  }

  audit(job.id, "hearing_job.created", {
    source_url: job.source_url,
    mode: job.mode,
    client_id: job.client_id,
  });
  return job;
}

export function listHearingJobs(): HearingJobSummary[] {
  purgeExpiredHearingData();
  const conn = getDb();
  return conn
    .prepare(
      `SELECT j.id, j.client_id, j.client_name, j.mode, j.status, j.hearing_title,
              j.committee, j.hearing_datetime, j.source_url, j.stream_url,
              j.stream_provider, j.capture_status, j.transcription_status, j.updated_at,
              (SELECT COUNT(*) FROM hearing_transcript_segments s WHERE s.hearing_job_id = j.id) AS transcript_segment_count,
              (SELECT COUNT(*) FROM hearing_watch_hits h WHERE h.hearing_job_id = j.id AND h.status != 'dismissed') AS watch_hit_count,
              (SELECT COUNT(*) FROM hearing_outputs o WHERE o.hearing_job_id = j.id) AS output_count
       FROM hearing_jobs j
       ORDER BY j.updated_at DESC`,
    )
    .all() as HearingJobSummary[];
}

export function getHearingJob(hearingJobId: string): HearingJob | null {
  const row = getDb()
    .prepare(`SELECT * FROM hearing_jobs WHERE id = ?`)
    .get(hearingJobId) as Record<string, unknown> | undefined;
  return row ? rowToJob(row) : null;
}

export function getHearingWorkspace(hearingJobId: string): HearingWorkspace | null {
  const job = getHearingJob(hearingJobId);
  if (!job) return null;
  const conn = getDb();
  const transcriptSegments = conn
    .prepare(
      `SELECT * FROM hearing_transcript_segments
       WHERE hearing_job_id = ?
       ORDER BY start_ms ASC, end_ms ASC`,
    )
    .all(hearingJobId)
    .map((row) => rowToSegment(row as Record<string, unknown>));
  const watchItems = conn
    .prepare(
      `SELECT * FROM hearing_watch_items
       WHERE hearing_job_id = ?
       ORDER BY importance DESC, label ASC`,
    )
    .all(hearingJobId)
    .map((row) => rowToWatchItem(row as Record<string, unknown>));
  const watchHits = conn
    .prepare(
      `SELECT * FROM hearing_watch_hits
       WHERE hearing_job_id = ?
       ORDER BY start_ms ASC`,
    )
    .all(hearingJobId)
    .map((row) => rowToHit(row as Record<string, unknown>));
  const outputs = conn
    .prepare(
      `SELECT * FROM hearing_outputs
       WHERE hearing_job_id = ?
       ORDER BY created_at DESC`,
    )
    .all(hearingJobId)
    .map((row) => rowToOutput(row as Record<string, unknown>));
  const outputIds = outputs.map((output) => output.id);
  const claims =
    outputIds.length === 0
      ? []
      : conn
          .prepare(
            `SELECT * FROM hearing_claims
             WHERE hearing_output_id IN (${outputIds.map(() => "?").join(",")})
             ORDER BY rowid ASC`,
          )
          .all(...outputIds)
          .map((row) => rowToClaim(row as Record<string, unknown>));
  const comments = conn
    .prepare(
      `SELECT * FROM hearing_comments
       WHERE hearing_job_id = ?
       ORDER BY created_at DESC`,
    )
    .all(hearingJobId)
    .map((row) => rowToComment(row as Record<string, unknown>));

  return {
    job,
    transcript_segments: transcriptSegments,
    watch_items: watchItems,
    watch_hits: watchHits,
    outputs,
    claims,
    comments,
  };
}

export function updateHearingJobStatus(
  hearingJobId: string,
  status: string,
  errorMessage = "",
): HearingJob {
  const parsedStatus = HearingStatusEnum.parse(status);
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE hearing_jobs
       SET status = ?, error_message = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(parsedStatus, errorMessage, now, hearingJobId);
  audit(hearingJobId, "hearing_job.status_updated", {
    status: parsedStatus,
    error_message: errorMessage,
  });
  const job = getHearingJob(hearingJobId);
  if (!job) throw new Error("Hearing job not found");
  return job;
}

export function applyResolvedMetadata(
  hearingJobId: string,
  metadata: HearingResolvedMetadata,
): HearingJob {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE hearing_jobs
       SET source_type = ?, source_reliability_tier = ?, status = ?,
           hearing_title = ?, chamber = ?, committee = ?, subcommittee = ?,
           hearing_datetime = ?, witnesses_json = ?, metadata_json = ?,
           stream_url = ?, stream_provider = ?, stream_confidence = ?,
           capture_status = ?,
           error_message = '', updated_at = ?
       WHERE id = ?`,
    )
    .run(
      metadata.source_type,
      metadata.source_reliability_tier,
      metadata.stream_url ? "stream_resolved" : "metadata_resolved",
      metadata.hearing_title,
      metadata.chamber,
      metadata.committee,
      metadata.subcommittee,
      metadata.hearing_datetime,
      jsonString(metadata.witnesses),
      jsonString(metadata),
      metadata.stream_url,
      metadata.stream_provider,
      metadata.stream_confidence,
      metadata.stream_url ? "resolved" : "idle",
      now,
      hearingJobId,
    );
  audit(hearingJobId, "hearing_source.resolved", {
    source_type: metadata.source_type,
    source_reliability_tier: metadata.source_reliability_tier,
    bill_references: metadata.bill_references,
  });
  const job = getHearingJob(hearingJobId);
  if (!job) throw new Error("Hearing job not found");
  return job;
}

export function replaceTranscriptSegments(
  hearingJobId: string,
  segments: HearingTranscriptSegment[],
): HearingTranscriptSegment[] {
  const conn = getDb();
  const tx = conn.transaction(() => {
    conn
      .prepare(`DELETE FROM hearing_transcript_segments WHERE hearing_job_id = ?`)
      .run(hearingJobId);
    const insert = conn.prepare(
      `INSERT INTO hearing_transcript_segments
       (id, hearing_job_id, start_ms, end_ms, speaker_label, speaker_type,
        speaker_confidence, text, asr_confidence, source, review_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const segment of segments) {
      const parsed = HearingTranscriptSegmentSchema.parse(segment);
      insert.run(
        parsed.segmentId,
        hearingJobId,
        parsed.startMs,
        parsed.endMs,
        parsed.speakerLabel,
        parsed.speakerType,
        parsed.speakerConfidence,
        parsed.text,
        parsed.asrConfidence,
        parsed.source,
        parsed.reviewStatus,
      );
    }
    conn
      .prepare(
        `UPDATE hearing_jobs
         SET status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run("ready_for_review", new Date().toISOString(), hearingJobId);
  });
  tx();
  audit(hearingJobId, "hearing_transcript.imported", {
    segment_count: segments.length,
  });
  return segments;
}

export function appendTranscriptSegments(
  hearingJobId: string,
  segments: HearingTranscriptSegment[],
): HearingTranscriptSegment[] {
  if (segments.length === 0) return [];
  const conn = getDb();
  const insert = conn.prepare(
    `INSERT OR IGNORE INTO hearing_transcript_segments
     (id, hearing_job_id, start_ms, end_ms, speaker_label, speaker_type,
      speaker_confidence, text, asr_confidence, source, review_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = conn.transaction(() => {
    for (const segment of segments) {
      const parsed = HearingTranscriptSegmentSchema.parse(segment);
      insert.run(
        parsed.segmentId,
        hearingJobId,
        parsed.startMs,
        parsed.endMs,
        parsed.speakerLabel,
        parsed.speakerType,
        parsed.speakerConfidence,
        parsed.text,
        parsed.asrConfidence,
        parsed.source,
        parsed.reviewStatus,
      );
    }
    conn
      .prepare(
        `UPDATE hearing_jobs
         SET status = ?, transcription_status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run("transcribing", "transcribing", new Date().toISOString(), hearingJobId);
  });
  tx();
  audit(hearingJobId, "hearing_transcript.live_chunk_imported", {
    segment_count: segments.length,
  });
  return segments;
}

export function updateHearingCaptureState(
  hearingJobId: string,
  updates: Partial<
    Pick<
      HearingJob,
      | "status"
      | "stream_url"
      | "stream_provider"
      | "stream_confidence"
      | "capture_status"
      | "capture_started_at"
      | "capture_stopped_at"
      | "audio_chunk_count"
      | "transcription_status"
      | "capture_error"
    >
  >,
): HearingJob {
  const current = getHearingJob(hearingJobId);
  if (!current) throw new Error("Hearing job not found");
  const next = {
    status: updates.status ?? current.status,
    stream_url: updates.stream_url ?? current.stream_url,
    stream_provider: updates.stream_provider ?? current.stream_provider,
    stream_confidence: updates.stream_confidence ?? current.stream_confidence,
    capture_status: updates.capture_status ?? current.capture_status,
    capture_started_at:
      updates.capture_started_at === undefined
        ? current.capture_started_at
        : updates.capture_started_at,
    capture_stopped_at:
      updates.capture_stopped_at === undefined
        ? current.capture_stopped_at
        : updates.capture_stopped_at,
    audio_chunk_count: updates.audio_chunk_count ?? current.audio_chunk_count,
    transcription_status:
      updates.transcription_status ?? current.transcription_status,
    capture_error: updates.capture_error ?? current.capture_error,
  };
  HearingJobSchema.parse({ ...current, ...next });
  getDb()
    .prepare(
      `UPDATE hearing_jobs
       SET status = ?, stream_url = ?, stream_provider = ?, stream_confidence = ?,
           capture_status = ?, capture_started_at = ?, capture_stopped_at = ?,
           audio_chunk_count = ?, transcription_status = ?, capture_error = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      next.status,
      next.stream_url,
      next.stream_provider,
      next.stream_confidence,
      next.capture_status,
      next.capture_started_at,
      next.capture_stopped_at,
      next.audio_chunk_count,
      next.transcription_status,
      next.capture_error,
      new Date().toISOString(),
      hearingJobId,
    );
  audit(hearingJobId, "hearing_capture.state_updated", next);
  const job = getHearingJob(hearingJobId);
  if (!job) throw new Error("Hearing job not found");
  return job;
}

export function updateTranscriptSegmentReview(
  segmentId: string,
  reviewStatus: ReviewStatus,
  speakerLabel?: string,
): HearingTranscriptSegment {
  const parsedStatus = ReviewStatusEnum.parse(reviewStatus);
  const existing = getDb()
    .prepare(`SELECT * FROM hearing_transcript_segments WHERE id = ?`)
    .get(segmentId) as Record<string, unknown> | undefined;
  if (!existing) throw new Error("Transcript segment not found");

  getDb()
    .prepare(
      `UPDATE hearing_transcript_segments
       SET review_status = ?, speaker_label = ?
       WHERE id = ?`,
    )
    .run(parsedStatus, speakerLabel ?? existing.speaker_label, segmentId);

  const updated = getDb()
    .prepare(`SELECT * FROM hearing_transcript_segments WHERE id = ?`)
    .get(segmentId) as Record<string, unknown>;
  audit(String(existing.hearing_job_id), "hearing_transcript.segment_reviewed", {
    segment_id: segmentId,
    review_status: parsedStatus,
  });
  return rowToSegment(updated);
}

export function replaceWatchItems(
  hearingJobId: string,
  items: HearingWatchItemDraft[],
): HearingWatchItem[] {
  const conn = getDb();
  const parsed = items
    .filter((item) => item.label.trim())
    .map((item) => HearingWatchItemDraftSchema.parse(item));
  const stored: HearingWatchItem[] = parsed.map((item) =>
    HearingWatchItemSchema.parse({
      id: item.id ?? uuidv4(),
      hearing_job_id: hearingJobId,
      type: item.type,
      label: item.label.trim(),
      aliases: item.aliases.map((alias) => alias.trim()).filter(Boolean),
      match_mode: item.match_mode,
      importance: item.importance,
      negative_filters: item.negative_filters
        .map((filter) => filter.trim())
        .filter(Boolean),
    }),
  );

  const tx = conn.transaction(() => {
    conn.prepare(`DELETE FROM hearing_watch_hits WHERE hearing_job_id = ?`).run(hearingJobId);
    conn.prepare(`DELETE FROM hearing_watch_items WHERE hearing_job_id = ?`).run(hearingJobId);
    const insert = conn.prepare(
      `INSERT INTO hearing_watch_items
       (id, hearing_job_id, type, label, aliases_json, match_mode, importance,
        negative_filters_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of stored) {
      insert.run(
        item.id,
        item.hearing_job_id,
        item.type,
        item.label,
        jsonString(item.aliases),
        item.match_mode,
        item.importance,
        jsonString(item.negative_filters),
      );
    }
    conn
      .prepare(`UPDATE hearing_jobs SET updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), hearingJobId);
  });
  tx();
  audit(hearingJobId, "hearing_watchlist.updated", {
    watch_item_count: stored.length,
  });
  return stored;
}

export function replaceWatchHits(
  hearingJobId: string,
  hits: HearingWatchHit[],
): HearingWatchHit[] {
  const conn = getDb();
  const tx = conn.transaction(() => {
    conn.prepare(`DELETE FROM hearing_watch_hits WHERE hearing_job_id = ?`).run(hearingJobId);
    const insert = conn.prepare(
      `INSERT INTO hearing_watch_hits
       (id, watch_item_id, hearing_job_id, start_ms, end_ms, trigger_text,
        match_type, confidence, speaker_labels_json, segment_ids_json,
        client_relevance, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const hit of hits) {
      const parsed = HearingWatchHitSchema.parse(hit);
      insert.run(
        parsed.hitId,
        parsed.watchItemId,
        hearingJobId,
        parsed.startMs,
        parsed.endMs,
        parsed.triggerText,
        parsed.matchType,
        parsed.confidence,
        jsonString(parsed.speakerLabels),
        jsonString(parsed.transcriptSegmentIds),
        parsed.clientRelevance,
        parsed.status,
      );
    }
    conn
      .prepare(
        `UPDATE hearing_jobs
         SET status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run("ready_for_review", new Date().toISOString(), hearingJobId);
  });
  tx();
  audit(hearingJobId, "hearing_watchlist.detected", {
    hit_count: hits.length,
  });
  return hits;
}

export function updateWatchHitStatus(
  hitId: string,
  status: WatchHitStatus,
): HearingWatchHit {
  const parsedStatus = WatchHitStatusEnum.parse(status);
  const conn = getDb();
  const row = conn
    .prepare(`SELECT * FROM hearing_watch_hits WHERE id = ?`)
    .get(hitId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Watchlist hit not found");
  conn.prepare(`UPDATE hearing_watch_hits SET status = ? WHERE id = ?`).run(
    parsedStatus,
    hitId,
  );
  audit(String(row.hearing_job_id), "hearing_watch_hit.status_updated", {
    hit_id: hitId,
    status: parsedStatus,
  });
  const updated = conn
    .prepare(`SELECT * FROM hearing_watch_hits WHERE id = ?`)
    .get(hitId) as Record<string, unknown>;
  return rowToHit(updated);
}

export function createHearingOutput(
  hearingJobId: string,
  type: HearingOutputType,
  contentMarkdown: string,
  contentJson: Record<string, unknown>,
  claims: Array<Omit<HearingClaim, "id" | "hearing_output_id">>,
  modelMetadata: Record<string, unknown>,
): HearingOutput {
  const parsedType = HearingOutputTypeEnum.parse(type);
  const now = new Date().toISOString();
  const output: HearingOutput = {
    id: uuidv4(),
    hearing_job_id: hearingJobId,
    type: parsedType,
    content_json: contentJson,
    content_markdown: contentMarkdown,
    review_status: "needs_review",
    model_metadata: modelMetadata,
    created_by: LOCAL_USER_ID,
    created_at: now,
    updated_at: now,
  };
  const conn = getDb();
  const tx = conn.transaction(() => {
    conn
      .prepare(
        `INSERT INTO hearing_outputs
         (id, hearing_job_id, type, content_json, content_markdown,
          review_status, model_metadata_json, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        output.id,
        output.hearing_job_id,
        output.type,
        jsonString(output.content_json),
        output.content_markdown,
        output.review_status,
        jsonString(output.model_metadata),
        output.created_by,
        output.created_at,
        output.updated_at,
      );
    const insertClaim = conn.prepare(
      `INSERT INTO hearing_claims
       (id, hearing_output_id, claim_text, supporting_segment_ids_json,
        supporting_external_sources_json, confidence, verification_status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const claim of claims) {
      insertClaim.run(
        uuidv4(),
        output.id,
        claim.claim_text,
        jsonString(claim.supporting_segment_ids),
        jsonString(claim.supporting_external_sources),
        claim.confidence,
        claim.verification_status,
      );
    }
    conn
      .prepare(
        `UPDATE hearing_jobs
         SET status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run("ready_for_review", now, hearingJobId);
  });
  tx();
  audit(hearingJobId, "hearing_output.generated", {
    output_id: output.id,
    type: output.type,
    claim_count: claims.length,
  });
  return output;
}

export function updateHearingOutput(
  outputId: string,
  contentMarkdown: string,
  reviewStatus: ReviewStatus,
): HearingOutput {
  const parsedStatus = ReviewStatusEnum.parse(reviewStatus);
  const now = new Date().toISOString();
  const conn = getDb();
  const row = conn
    .prepare(`SELECT * FROM hearing_outputs WHERE id = ?`)
    .get(outputId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Hearing output not found");
  conn
    .prepare(
      `UPDATE hearing_outputs
       SET content_markdown = ?, review_status = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(contentMarkdown, parsedStatus, now, outputId);
  audit(String(row.hearing_job_id), "hearing_output.updated", {
    output_id: outputId,
    review_status: parsedStatus,
  });
  const updated = conn
    .prepare(`SELECT * FROM hearing_outputs WHERE id = ?`)
    .get(outputId) as Record<string, unknown>;
  return rowToOutput(updated);
}

export function updateHearingClaimStatus(
  claimId: string,
  verificationStatus: VerificationStatus,
): HearingClaim {
  const conn = getDb();
  const row = conn
    .prepare(
      `SELECT c.*, o.hearing_job_id
       FROM hearing_claims c
       INNER JOIN hearing_outputs o ON o.id = c.hearing_output_id
       WHERE c.id = ?`,
    )
    .get(claimId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Hearing claim not found");
  conn
    .prepare(`UPDATE hearing_claims SET verification_status = ? WHERE id = ?`)
    .run(verificationStatus, claimId);
  audit(String(row.hearing_job_id), "hearing_claim.status_updated", {
    claim_id: claimId,
    verification_status: verificationStatus,
  });
  const updated = conn
    .prepare(`SELECT * FROM hearing_claims WHERE id = ?`)
    .get(claimId) as Record<string, unknown>;
  return rowToClaim(updated);
}

export function addHearingComment(
  hearingJobId: string,
  targetType: HearingComment["target_type"],
  targetId: string,
  comment: string,
): HearingComment {
  const trimmed = comment.trim();
  if (!trimmed) throw new Error("Comment cannot be empty");
  const entry: HearingComment = {
    id: uuidv4(),
    hearing_job_id: hearingJobId,
    target_type: targetType,
    target_id: targetId,
    comment: trimmed,
    created_by: LOCAL_USER_ID,
    created_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `INSERT INTO hearing_comments
       (id, hearing_job_id, target_type, target_id, comment, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.id,
      entry.hearing_job_id,
      entry.target_type,
      entry.target_id,
      entry.comment,
      entry.created_by,
      entry.created_at,
    );
  audit(hearingJobId, "hearing_comment.created", {
    target_type: targetType,
    target_id: targetId,
  });
  return HearingCommentSchema.parse(entry);
}

export function markHearingExported(
  hearingJobId: string,
  format: string,
  outputId?: string,
): void {
  getDb()
    .prepare(
      `UPDATE hearing_jobs
       SET status = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run("exported", new Date().toISOString(), hearingJobId);
  audit(hearingJobId, "hearing_export.created", { format, output_id: outputId });
}

export function getCongressionalCache(cacheKey: string): unknown | null {
  const row = getDb()
    .prepare(
      `SELECT value_json, expires_at
       FROM hearing_congressional_cache
       WHERE cache_key = ?`,
    )
    .get(cacheKey) as { value_json: string; expires_at: string } | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return parseJson(row.value_json, null);
}

export function putCongressionalCache(
  cacheKey: string,
  source: string,
  value: unknown,
  ttlMs: number,
): void {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  getDb()
    .prepare(
      `INSERT INTO hearing_congressional_cache
       (cache_key, source, value_json, fetched_at, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         source = excluded.source,
         value_json = excluded.value_json,
         fetched_at = excluded.fetched_at,
         expires_at = excluded.expires_at`,
    )
    .run(
      cacheKey,
      source,
      jsonString(value),
      now.toISOString(),
      expiresAt.toISOString(),
    );
}

export function clearHearings(): void {
  const conn = getDb();
  conn.exec(`
    DELETE FROM hearing_comments;
    DELETE FROM hearing_claims;
    DELETE FROM hearing_outputs;
    DELETE FROM hearing_watch_hits;
    DELETE FROM hearing_watch_items;
    DELETE FROM hearing_transcript_segments;
    DELETE FROM hearing_jobs;
    DELETE FROM hearing_audit_events;
    DELETE FROM hearing_congressional_cache;
  `);
}

export function transcriptSourceOrDefault(value: string): "manual" | "asr" | "live_asr" | "official_caption" | "official_transcript" {
  return TranscriptSourceEnum.catch("manual").parse(value);
}

export function purgeExpiredHearingData(now = new Date()): number {
  const days = Number(process.env.HEARING_RETENTION_DAYS ?? "0");
  if (!Number.isFinite(days) || days <= 0) return 0;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = getDb()
    .prepare(`DELETE FROM hearing_jobs WHERE updated_at < ?`)
    .run(cutoff);
  if (result.changes > 0) {
    audit(null, "hearing_retention.purged", {
      cutoff,
      days,
      deleted_jobs: result.changes,
    });
  }
  return result.changes;
}
