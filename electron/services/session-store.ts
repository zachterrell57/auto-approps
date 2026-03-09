import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { getUserDataPath } from "./config.js";
import type { SessionMeta, SessionFull, SavedTarget, TargetKind } from "./models.js";

// ---------------------------------------------------------------------------
// Singleton DB handle
// ---------------------------------------------------------------------------

let db: BetterSqlite3.Database | null = null;

function hasColumn(
  conn: BetterSqlite3.Database,
  tableName: string,
  columnName: string,
): boolean {
  const rows = conn
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function getDb(): BetterSqlite3.Database {
  if (db !== null) {
    return db;
  }

  const dbPath = path.join(getUserDataPath(), "sessions.db");
  const dbDir = path.dirname(dbPath);

  fs.mkdirSync(dbDir, { recursive: true });

  const conn = new Database(dbPath);
  conn.pragma("journal_mode = WAL");

  conn.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id                TEXT PRIMARY KEY,
      created_at        TEXT NOT NULL,
      last_updated_at   TEXT NOT NULL,
      document_filename TEXT,
      document_bytes    BLOB,
      form_url          TEXT NOT NULL DEFAULT '',
      form_title        TEXT NOT NULL DEFAULT '',
      form_provider     TEXT NOT NULL DEFAULT '',
      display_name      TEXT NOT NULL DEFAULT '',
      form_schema       TEXT NOT NULL,
      mapping_result    TEXT NOT NULL,
      edited_mappings   TEXT
    )
  `);

  if (!hasColumn(conn, "sessions", "display_name")) {
    conn.exec(
      "ALTER TABLE sessions ADD COLUMN display_name TEXT NOT NULL DEFAULT ''",
    );
  }

  if (!hasColumn(conn, "sessions", "last_updated_at")) {
    conn.exec(
      "ALTER TABLE sessions ADD COLUMN last_updated_at TEXT NOT NULL DEFAULT ''",
    );
  }

  conn.exec(`
    UPDATE sessions
    SET last_updated_at = created_at
    WHERE last_updated_at IS NULL OR last_updated_at = ''
  `);

  if (!hasColumn(conn, "sessions", "source_document_filename")) {
    conn.exec(
      "ALTER TABLE sessions ADD COLUMN source_document_filename TEXT",
    );
  }

  if (!hasColumn(conn, "sessions", "source_document_bytes")) {
    conn.exec(
      "ALTER TABLE sessions ADD COLUMN source_document_bytes BLOB",
    );
  }

  if (!hasColumn(conn, "sessions", "target_kind")) {
    conn.exec(
      "ALTER TABLE sessions ADD COLUMN target_kind TEXT NOT NULL DEFAULT 'web_form'",
    );
  }

  if (!hasColumn(conn, "sessions", "target_url")) {
    conn.exec(
      "ALTER TABLE sessions ADD COLUMN target_url TEXT NOT NULL DEFAULT ''",
    );
  }

  if (!hasColumn(conn, "sessions", "target_filename")) {
    conn.exec(
      "ALTER TABLE sessions ADD COLUMN target_filename TEXT",
    );
  }

  if (!hasColumn(conn, "sessions", "target_document_bytes")) {
    conn.exec(
      "ALTER TABLE sessions ADD COLUMN target_document_bytes BLOB",
    );
  }

  if (!hasColumn(conn, "sessions", "target_title")) {
    conn.exec(
      "ALTER TABLE sessions ADD COLUMN target_title TEXT NOT NULL DEFAULT ''",
    );
  }

  if (!hasColumn(conn, "sessions", "target_provider")) {
    conn.exec(
      "ALTER TABLE sessions ADD COLUMN target_provider TEXT NOT NULL DEFAULT ''",
    );
  }

  conn.exec(`
    UPDATE sessions
    SET source_document_filename = document_filename,
        source_document_bytes = document_bytes
    WHERE (source_document_filename IS NULL OR source_document_filename = '')
      AND document_filename IS NOT NULL
  `);

  conn.exec(`
    UPDATE sessions
    SET target_kind = 'web_form',
        target_url = form_url,
        target_title = form_title,
        target_provider = form_provider
    WHERE target_kind IS NULL
       OR target_kind = ''
       OR (target_kind = 'web_form' AND target_title = '' AND form_title != '')
  `);

  db = conn;
  return db;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return unique targets (grouped by URL or filename) with the most recent
 * session for each identity.
 */
export function listSavedForms(): SavedTarget[] {
  const conn = getDb();
  const rows = conn
    .prepare(
      `SELECT s.target_kind, s.target_url, s.target_filename, s.target_title, s.display_name
       FROM sessions s
       INNER JOIN (
         SELECT target_kind,
                CASE
                  WHEN target_kind = 'web_form' THEN target_url
                  ELSE COALESCE(target_filename, '')
                END AS target_key,
                MAX(created_at) AS max_created
         FROM sessions
         WHERE (target_kind = 'web_form' AND target_url != '')
            OR (target_kind != 'web_form' AND COALESCE(target_filename, '') != '')
         GROUP BY target_kind, target_key
       ) cnt ON s.target_kind = cnt.target_kind
             AND CASE
                   WHEN s.target_kind = 'web_form' THEN s.target_url
                   ELSE COALESCE(s.target_filename, '')
                 END = cnt.target_key
             AND s.created_at = cnt.max_created
       ORDER BY s.created_at DESC`
    )
    .all() as SavedTarget[];

  return rows;
}

/**
 * Return lightweight metadata for every session, newest first.
 */
export function listSessions(): SessionMeta[] {
  const conn = getDb();
  const rows = conn
    .prepare(
      `SELECT id, created_at, last_updated_at, source_document_filename, target_kind, target_url,
              target_filename, target_title, target_provider, display_name
       FROM sessions
       ORDER BY last_updated_at DESC, created_at DESC`
    )
    .all() as SessionMeta[];

  return rows;
}

/**
 * Fetch a single session with its full JSON payloads parsed.
 * Returns `null` when the id is not found.
 */
export function getSession(sessionId: string): SessionFull | null {
  const conn = getDb();
  const row = conn
    .prepare(
      `SELECT id, created_at, last_updated_at, source_document_filename, target_kind, target_url,
              target_filename, target_title, target_provider, display_name,
              form_schema, mapping_result, edited_mappings
       FROM sessions
       WHERE id = ?`
    )
    .get(sessionId) as
    | {
        id: string;
        created_at: string;
        last_updated_at: string;
        source_document_filename: string | null;
        target_kind: TargetKind;
        target_url: string;
        target_filename: string | null;
        target_title: string;
        target_provider: string;
        display_name: string;
        form_schema: string;
        mapping_result: string;
        edited_mappings: string | null;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    created_at: row.created_at,
    last_updated_at: row.last_updated_at,
    source_document_filename: row.source_document_filename,
    target_kind: row.target_kind,
    target_url: row.target_url,
    target_filename: row.target_filename,
    target_title: row.target_title,
    target_provider: row.target_provider,
    display_name: row.display_name,
    target_schema: JSON.parse(row.form_schema),
    mapping_result: JSON.parse(row.mapping_result),
    edited_mappings: row.edited_mappings
      ? JSON.parse(row.edited_mappings)
      : null,
  };
}

/**
 * Retrieve the raw source document bytes and filename for a session.
 * Returns `null` when the id is not found.
 */
export function getSessionDocument(
  sessionId: string
): { documentBytes: Buffer; documentFilename: string } | null {
  const conn = getDb();
  const row = conn
    .prepare(
      "SELECT source_document_bytes, source_document_filename FROM sessions WHERE id = ?"
    )
    .get(sessionId) as
    | {
        source_document_bytes: Buffer | null;
        source_document_filename: string | null;
      }
    | undefined;

  if (
    !row ||
    !row.source_document_bytes ||
    !row.source_document_filename
  ) {
    return null;
  }

  return {
    documentBytes: Buffer.from(row.source_document_bytes),
    documentFilename: row.source_document_filename,
  };
}

/**
 * Retrieve the raw target document bytes and filename for a session.
 * Returns `null` when the id is not found or the session has no target file.
 */
export function getSessionTargetDocument(
  sessionId: string,
): { documentBytes: Buffer; documentFilename: string } | null {
  const conn = getDb();
  const row = conn
    .prepare(
      "SELECT target_document_bytes, target_filename FROM sessions WHERE id = ?",
    )
    .get(sessionId) as
    | { target_document_bytes: Buffer | null; target_filename: string | null }
    | undefined;

  if (!row || !row.target_document_bytes || !row.target_filename) {
    return null;
  }

  return {
    documentBytes: Buffer.from(row.target_document_bytes),
    documentFilename: row.target_filename,
  };
}

/**
 * Create a new session and return its metadata.
 */
export function createSession(params: {
  sourceDocumentFilename?: string | null;
  sourceDocumentBytes?: Buffer | null;
  targetKind?: TargetKind;
  targetUrl?: string;
  targetFilename?: string | null;
  targetDocumentBytes?: Buffer | null;
  targetTitle?: string;
  targetProvider?: string;
  displayName?: string;
  targetSchema: Record<string, unknown>;
  mappingResult: Record<string, unknown>;
}): SessionMeta {
  const conn = getDb();
  const id = uuidv4();
  const createdAt = new Date().toISOString();
  const displayName =
    params.displayName ??
    params.targetTitle ??
    params.targetFilename ??
    params.sourceDocumentFilename ??
    "";

  conn
    .prepare(
      `INSERT INTO sessions
         (id, created_at, last_updated_at, document_filename, document_bytes, source_document_filename,
          source_document_bytes, form_url, form_title, form_provider, target_kind, target_url,
          target_filename, target_document_bytes, target_title, target_provider, display_name,
          form_schema, mapping_result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      createdAt,
      createdAt,
      params.sourceDocumentFilename ?? null,
      params.sourceDocumentBytes ?? null,
      params.sourceDocumentFilename ?? null,
      params.sourceDocumentBytes ?? null,
      params.targetUrl ?? "",
      params.targetTitle ?? "",
      params.targetProvider ?? "",
      params.targetKind ?? "web_form",
      params.targetUrl ?? "",
      params.targetFilename ?? null,
      params.targetDocumentBytes ?? null,
      params.targetTitle ?? "",
      params.targetProvider ?? "",
      displayName,
      JSON.stringify(params.targetSchema),
      JSON.stringify(params.mappingResult)
    );

  return {
    id,
    created_at: createdAt,
    last_updated_at: createdAt,
    source_document_filename: params.sourceDocumentFilename ?? null,
    target_kind: params.targetKind ?? "web_form",
    target_url: params.targetUrl ?? "",
    target_filename: params.targetFilename ?? null,
    target_title: params.targetTitle ?? "",
    target_provider: params.targetProvider ?? "",
    display_name: displayName,
  };
}

/**
 * Update a session display name.
 * Returns `true` if a row was updated, `false` if the id was not found.
 */
export function renameSession(
  sessionId: string,
  displayName: string,
): boolean {
  const conn = getDb();
  const result = conn
    .prepare("UPDATE sessions SET display_name = ? WHERE id = ?")
    .run(displayName, sessionId);
  return result.changes > 0;
}

/**
 * Overwrite the edited_mappings column for a session.
 * Returns `true` if a row was updated, `false` if the id was not found.
 */
export function updateSessionMappings(
  sessionId: string,
  mappings: Record<string, unknown>[]
): boolean {
  const conn = getDb();
  const lastUpdatedAt = new Date().toISOString();
  const result = conn
    .prepare(
      "UPDATE sessions SET edited_mappings = ?, last_updated_at = ? WHERE id = ?",
    )
    .run(JSON.stringify(mappings), lastUpdatedAt, sessionId);

  return result.changes > 0;
}

/**
 * Delete a session by id.
 * Returns `true` if a row was deleted, `false` if the id was not found.
 */
export function deleteSession(sessionId: string): boolean {
  const conn = getDb();
  const result = conn
    .prepare("DELETE FROM sessions WHERE id = ?")
    .run(sessionId);

  return result.changes > 0;
}

/**
 * Remove all persisted session data, including SQLite and WAL sidecars.
 */
export function clearSessions(): void {
  if (db !== null) {
    db.close();
    db = null;
  }

  const dbPath = path.join(getUserDataPath(), "sessions.db");
  const sidecars = [dbPath, `${dbPath}-shm`, `${dbPath}-wal`];
  for (const filePath of sidecars) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Best-effort cleanup.
    }
  }
}
