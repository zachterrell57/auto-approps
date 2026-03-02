import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { getUserDataPath } from "./config.js";
import type { SessionMeta, SessionFull } from "./models.js";

// ---------------------------------------------------------------------------
// Singleton DB handle
// ---------------------------------------------------------------------------

let db: BetterSqlite3.Database | null = null;

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
      document_filename TEXT NOT NULL,
      document_bytes    BLOB NOT NULL,
      form_url          TEXT NOT NULL DEFAULT '',
      form_title        TEXT NOT NULL DEFAULT '',
      form_provider     TEXT NOT NULL DEFAULT '',
      form_schema       TEXT NOT NULL,
      mapping_result    TEXT NOT NULL,
      edited_mappings   TEXT,
      display_name      TEXT NOT NULL DEFAULT ''
    )
  `);

  // Migrate existing databases that lack the display_name column.
  const cols = conn.pragma("table_info(sessions)") as { name: string }[];
  if (!cols.some((c) => c.name === "display_name")) {
    conn.exec(
      "ALTER TABLE sessions ADD COLUMN display_name TEXT NOT NULL DEFAULT ''"
    );
  }

  db = conn;
  return db;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return lightweight metadata for every session, newest first.
 */
export function listSessions(): SessionMeta[] {
  const conn = getDb();
  const rows = conn
    .prepare(
      `SELECT id, created_at, document_filename, form_url, form_title, form_provider, display_name
       FROM sessions
       ORDER BY created_at DESC`
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
      `SELECT id, created_at, document_filename, form_url, form_title, form_provider,
              display_name, form_schema, mapping_result, edited_mappings
       FROM sessions
       WHERE id = ?`
    )
    .get(sessionId) as
    | {
        id: string;
        created_at: string;
        document_filename: string;
        form_url: string;
        form_title: string;
        form_provider: string;
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
    document_filename: row.document_filename,
    form_url: row.form_url,
    form_title: row.form_title,
    form_provider: row.form_provider,
    display_name: row.display_name,
    form_schema: JSON.parse(row.form_schema),
    mapping_result: JSON.parse(row.mapping_result),
    edited_mappings: row.edited_mappings
      ? JSON.parse(row.edited_mappings)
      : null,
  };
}

/**
 * Retrieve the raw document bytes and filename for a session.
 * Returns `null` when the id is not found.
 */
export function getSessionDocument(
  sessionId: string
): { documentBytes: Buffer; documentFilename: string } | null {
  const conn = getDb();
  const row = conn
    .prepare(
      "SELECT document_bytes, document_filename FROM sessions WHERE id = ?"
    )
    .get(sessionId) as
    | { document_bytes: Buffer; document_filename: string }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    documentBytes: Buffer.from(row.document_bytes),
    documentFilename: row.document_filename,
  };
}

/**
 * Create a new session and return its metadata.
 */
export function createSession(params: {
  documentFilename: string;
  documentBytes: Buffer;
  formUrl?: string;
  formTitle?: string;
  formProvider?: string;
  formSchema: Record<string, unknown>;
  mappingResult: Record<string, unknown>;
}): SessionMeta {
  const conn = getDb();
  const id = uuidv4();
  const createdAt = new Date().toISOString();

  conn
    .prepare(
      `INSERT INTO sessions
         (id, created_at, document_filename, document_bytes, form_url, form_title,
          form_provider, form_schema, mapping_result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      createdAt,
      params.documentFilename,
      params.documentBytes,
      params.formUrl ?? "",
      params.formTitle ?? "",
      params.formProvider ?? "",
      JSON.stringify(params.formSchema),
      JSON.stringify(params.mappingResult)
    );

  return {
    id,
    created_at: createdAt,
    document_filename: params.documentFilename,
    form_url: params.formUrl ?? "",
    form_title: params.formTitle ?? "",
    form_provider: params.formProvider ?? "",
    display_name: "",
  };
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
  const result = conn
    .prepare("UPDATE sessions SET edited_mappings = ? WHERE id = ?")
    .run(JSON.stringify(mappings), sessionId);

  return result.changes > 0;
}

/**
 * Update the display_name for a session.
 * Returns `true` if a row was updated, `false` if the id was not found.
 */
export function renameSession(
  sessionId: string,
  displayName: string
): boolean {
  const conn = getDb();
  const result = conn
    .prepare("UPDATE sessions SET display_name = ? WHERE id = ?")
    .run(displayName, sessionId);

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
