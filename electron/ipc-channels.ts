/**
 * IPC channel name constants for communication between the renderer and main
 * processes.
 *
 * Naming convention: "app:<resource>:<verb>" keeps channels scannable and
 * avoids collisions with Electron built-in channels.
 */

// ── Source document upload & retrieval ─────────────────────────────────────
/** Takes { buffer: Buffer; filename: string }, returns UploadResponse */
export const UPLOAD = "app:document:upload" as const;

/** Returns Buffer (the raw source docx bytes currently held in memory) */
export const GET_DOCUMENT = "app:document:get" as const;

// ── Target preparation & retrieval ─────────────────────────────────────────
/** Takes either { url } or { buffer + filename }, returns TargetSchema */
export const PREPARE_TARGET = "app:target:prepare" as const;

/** Returns Buffer for the raw target questionnaire currently held in memory */
export const GET_TARGET_DOCUMENT = "app:target:get" as const;

/** Takes workflow + mappings, returns a filled target document when supported */
export const DOWNLOAD_FILLED_TARGET = "app:target:download-filled" as const;

// ── Knowledge profile ──────────────────────────────────────────────────────
/** Returns KnowledgeProfile */
export const GET_KNOWLEDGE_PROFILE = "app:knowledge-profile:get" as const;

/** Takes KnowledgeProfileUpdate, returns KnowledgeProfile */
export const PUT_KNOWLEDGE_PROFILE = "app:knowledge-profile:put" as const;

// ── App settings ───────────────────────────────────────────────────────────
/** Returns AppSettings */
export const GET_SETTINGS = "app:settings:get" as const;

/** Takes { anthropic_api_key: string }, returns AppSettings */
export const PUT_SETTINGS = "app:settings:put" as const;

/** Clears all locally stored settings/knowledge/clients/sessions */
export const CLEAR_LOCAL_DATA = "app:settings:clear-local-data" as const;

// ── Form scraping & mapping ────────────────────────────────────────────────
/** Takes { url: string }, returns FormSchema */
export const SCRAPE = "app:form:scrape" as const;

/** Returns MappingResult */
export const MAP = "app:form:map" as const;

/** Restore form_schema (and optionally doc) into transient state for re-mapping historical sessions */
export const HYDRATE_STATE = "app:form:hydrate-state" as const;

// ── Workflow lifecycle ──────────────────────────────────────────────────
/** Takes { workflow_id: string }, cleans up transient in-memory state */
export const DELETE_WORKFLOW = "app:workflow:delete" as const;

// ── Saved forms (unique by URL) ───────────────────────────────────────────
/** Returns SavedForm[] – one entry per unique form_url */
export const LIST_SAVED_FORMS = "app:forms:list-saved" as const;

// ── Sessions ───────────────────────────────────────────────────────────────
/** Returns SessionMeta[] */
export const LIST_SESSIONS = "app:sessions:list" as const;

/** Takes { id: string }, returns SessionFull */
export const GET_SESSION = "app:sessions:get" as const;

/** Takes SessionCreate + raw_docx_bytes (Buffer), returns SessionMeta */
export const CREATE_SESSION = "app:sessions:create" as const;

/** Takes { id: string; mappings: dict[] }, returns void */
export const UPDATE_SESSION_MAPPINGS =
  "app:sessions:update-mappings" as const;

/** Takes { id: string; display_name: string }, returns void */
export const RENAME_SESSION = "app:sessions:rename" as const;

/** Takes { id: string }, returns void */
export const DELETE_SESSION = "app:sessions:delete" as const;

/** Takes { id: string }, returns { bytes: Buffer; filename: string } */
export const GET_SESSION_DOCUMENT = "app:sessions:get-document" as const;

/** Takes { id: string }, returns { bytes: Buffer; filename: string } for a target document */
export const GET_SESSION_TARGET_DOCUMENT = "app:sessions:get-target-document" as const;

// ── Clients ──────────────────────────────────────────────────────────────
/** Returns Client[] */
export const LIST_CLIENTS = "app:clients:list" as const;

/** Takes ClientCreate, returns Client */
export const CREATE_CLIENT = "app:clients:create" as const;

/** Takes { id: string }, returns Client */
export const GET_CLIENT = "app:clients:get" as const;

/** Takes { id: string; ...ClientUpdate }, returns Client */
export const UPDATE_CLIENT = "app:clients:update" as const;

/** Takes { id: string }, returns void */
export const DELETE_CLIENT = "app:clients:delete" as const;

// ── Hearing Intelligence ───────────────────────────────────────────────
/** Returns HearingJobSummary[] */
export const LIST_HEARING_JOBS = "app:hearing-jobs:list" as const;

/** Takes { id: string }, returns HearingWorkspace */
export const GET_HEARING_WORKSPACE = "app:hearing-jobs:get-workspace" as const;

/** Takes HearingCreateInput, returns HearingJob */
export const CREATE_HEARING_JOB = "app:hearing-jobs:create" as const;

/** Takes { id: string }, resolves official source metadata */
export const RESOLVE_HEARING_JOB = "app:hearing-jobs:resolve" as const;

/** Takes { id: string }, resolves and ranks live stream candidates */
export const RESOLVE_HEARING_STREAM =
  "app:hearing-jobs:resolve-stream" as const;

/** Takes { id: string; stream_url? }, starts live stream capture */
export const START_HEARING_CAPTURE =
  "app:hearing-jobs:start-capture" as const;

/** Takes { id: string }, stops live stream capture and finalizes transcription */
export const STOP_HEARING_CAPTURE =
  "app:hearing-jobs:stop-capture" as const;

/** Takes { id: string }, returns the current hearing workspace/status */
export const GET_HEARING_CAPTURE_STATUS =
  "app:hearing-jobs:capture-status" as const;

/** Takes { id, output_type? }, finalizes transcript/watchlist and generates output */
export const GENERATE_FINAL_HEARING_BRIEF =
  "app:hearing-jobs:generate-final-brief" as const;

/** Takes transcript text/URL inputs, stores timestamped transcript segments */
export const IMPORT_HEARING_TRANSCRIPT =
  "app:hearing-jobs:import-transcript" as const;

/** Takes { id: string; watch_items }, replaces job watchlist */
export const UPDATE_HEARING_WATCHLIST =
  "app:hearing-jobs:update-watchlist" as const;

/** Takes { id: string }, runs watchlist detection over transcript */
export const RUN_HEARING_WATCHLIST =
  "app:hearing-jobs:run-watchlist" as const;

/** Takes { id, output_type, reviewer_instructions? }, generates memo/recap/brief */
export const GENERATE_HEARING_OUTPUT =
  "app:hearing-jobs:generate-output" as const;

/** Takes { id, output_type? }, runs resolver/transcript/watchlist/output pipeline */
export const RUN_HEARING_JOB = "app:hearing-jobs:run" as const;

/** Takes review update payload, returns updated pieces */
export const UPDATE_HEARING_REVIEW =
  "app:hearing-jobs:update-review" as const;

/** Takes comment payload, returns HearingComment */
export const ADD_HEARING_COMMENT = "app:hearing-jobs:add-comment" as const;

/** Takes { id, format, output_id? }, returns export bytes */
export const EXPORT_HEARING_RESULTS =
  "app:hearing-jobs:export" as const;

// ── App updates ──────────────────────────────────────────────────────────
/** Main → Renderer push: update status changed */
export const UPDATE_STATUS = "app:update:status" as const;

/** Renderer → Main: install downloaded update and restart */
export const INSTALL_UPDATE = "app:update:install" as const;

/** Renderer → Main: trigger a manual update check */
export const CHECK_FOR_UPDATE = "app:update:check" as const;

/** Renderer → Main: returns { version: string } */
export const GET_APP_VERSION = "app:update:get-version" as const;

// ── Aggregate type for type-safe handler registration ──────────────────────

export const IPC_CHANNELS = {
  UPLOAD,
  GET_DOCUMENT,
  PREPARE_TARGET,
  GET_TARGET_DOCUMENT,
  DOWNLOAD_FILLED_TARGET,
  GET_KNOWLEDGE_PROFILE,
  PUT_KNOWLEDGE_PROFILE,
  GET_SETTINGS,
  PUT_SETTINGS,
  CLEAR_LOCAL_DATA,
  SCRAPE,
  MAP,
  HYDRATE_STATE,
  DELETE_WORKFLOW,
  LIST_SAVED_FORMS,
  LIST_SESSIONS,
  GET_SESSION,
  CREATE_SESSION,
  UPDATE_SESSION_MAPPINGS,
  RENAME_SESSION,
  DELETE_SESSION,
  GET_SESSION_DOCUMENT,
  GET_SESSION_TARGET_DOCUMENT,
  LIST_CLIENTS,
  CREATE_CLIENT,
  GET_CLIENT,
  UPDATE_CLIENT,
  DELETE_CLIENT,
  LIST_HEARING_JOBS,
  GET_HEARING_WORKSPACE,
  CREATE_HEARING_JOB,
  RESOLVE_HEARING_JOB,
  RESOLVE_HEARING_STREAM,
  START_HEARING_CAPTURE,
  STOP_HEARING_CAPTURE,
  GET_HEARING_CAPTURE_STATUS,
  GENERATE_FINAL_HEARING_BRIEF,
  IMPORT_HEARING_TRANSCRIPT,
  UPDATE_HEARING_WATCHLIST,
  RUN_HEARING_WATCHLIST,
  GENERATE_HEARING_OUTPUT,
  RUN_HEARING_JOB,
  UPDATE_HEARING_REVIEW,
  ADD_HEARING_COMMENT,
  EXPORT_HEARING_RESULTS,
  UPDATE_STATUS,
  INSTALL_UPDATE,
  CHECK_FOR_UPDATE,
  GET_APP_VERSION,
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
