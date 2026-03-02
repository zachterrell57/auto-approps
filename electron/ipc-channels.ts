/**
 * IPC channel name constants for communication between the renderer and main
 * processes. Each channel corresponds to a FastAPI endpoint from the original
 * Python backend.
 *
 * Naming convention: "app:<resource>:<verb>" keeps channels scannable and
 * avoids collisions with Electron built-in channels.
 */

// ── Document upload & retrieval ────────────────────────────────────────────
/** Takes { buffer: Buffer; filename: string }, returns UploadResponse */
export const UPLOAD = "app:document:upload" as const;

/** Returns Buffer (the raw docx bytes currently held in memory) */
export const GET_DOCUMENT = "app:document:get" as const;

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

// ── Form scraping & mapping ────────────────────────────────────────────────
/** Takes { url: string }, returns FormSchema */
export const SCRAPE = "app:form:scrape" as const;

/** Returns MappingResult */
export const MAP = "app:form:map" as const;

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

/** Takes { id: string }, returns void */
export const DELETE_SESSION = "app:sessions:delete" as const;

/** Takes { id: string }, returns { bytes: Buffer; filename: string } */
export const GET_SESSION_DOCUMENT = "app:sessions:get-document" as const;

// ── Aggregate type for type-safe handler registration ──────────────────────

export const IPC_CHANNELS = {
  UPLOAD,
  GET_DOCUMENT,
  GET_KNOWLEDGE_PROFILE,
  PUT_KNOWLEDGE_PROFILE,
  GET_SETTINGS,
  PUT_SETTINGS,
  SCRAPE,
  MAP,
  LIST_SESSIONS,
  GET_SESSION,
  CREATE_SESSION,
  UPDATE_SESSION_MAPPINGS,
  DELETE_SESSION,
  GET_SESSION_DOCUMENT,
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
