from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

logger = logging.getLogger(__name__)

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "sessions.db"

_conn: sqlite3.Connection | None = None


def _get_conn(db_path: Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn

    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
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
            edited_mappings   TEXT
        )
        """
    )
    conn.commit()
    _conn = conn
    return _conn


def list_sessions(db_path: Path = DEFAULT_DB_PATH) -> list[dict]:
    conn = _get_conn(db_path)
    rows = conn.execute(
        """
        SELECT id, created_at, document_filename, form_url, form_title, form_provider
        FROM sessions
        ORDER BY created_at DESC
        """
    ).fetchall()
    return [dict(r) for r in rows]


def get_session(session_id: str, db_path: Path = DEFAULT_DB_PATH) -> dict | None:
    conn = _get_conn(db_path)
    row = conn.execute(
        """
        SELECT id, created_at, document_filename, form_url, form_title, form_provider,
               form_schema, mapping_result, edited_mappings
        FROM sessions
        WHERE id = ?
        """,
        (session_id,),
    ).fetchone()
    if row is None:
        return None
    result = dict(row)
    result["form_schema"] = json.loads(result["form_schema"])
    result["mapping_result"] = json.loads(result["mapping_result"])
    if result["edited_mappings"] is not None:
        result["edited_mappings"] = json.loads(result["edited_mappings"])
    return result


def get_session_document(
    session_id: str, db_path: Path = DEFAULT_DB_PATH
) -> tuple[bytes, str] | None:
    conn = _get_conn(db_path)
    row = conn.execute(
        "SELECT document_bytes, document_filename FROM sessions WHERE id = ?",
        (session_id,),
    ).fetchone()
    if row is None:
        return None
    return bytes(row["document_bytes"]), row["document_filename"]


def create_session(
    *,
    document_filename: str,
    document_bytes: bytes,
    form_url: str = "",
    form_title: str = "",
    form_provider: str = "",
    form_schema: dict,
    mapping_result: dict,
    db_path: Path = DEFAULT_DB_PATH,
) -> dict:
    conn = _get_conn(db_path)
    session_id = str(uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO sessions
            (id, created_at, document_filename, document_bytes, form_url, form_title,
             form_provider, form_schema, mapping_result)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            session_id,
            created_at,
            document_filename,
            document_bytes,
            form_url,
            form_title,
            form_provider,
            json.dumps(form_schema),
            json.dumps(mapping_result),
        ),
    )
    conn.commit()
    return {
        "id": session_id,
        "created_at": created_at,
        "document_filename": document_filename,
        "form_url": form_url,
        "form_title": form_title,
        "form_provider": form_provider,
    }


def update_session_mappings(
    session_id: str, mappings: list[dict], db_path: Path = DEFAULT_DB_PATH
) -> bool:
    conn = _get_conn(db_path)
    cur = conn.execute(
        "UPDATE sessions SET edited_mappings = ? WHERE id = ?",
        (json.dumps(mappings), session_id),
    )
    conn.commit()
    return cur.rowcount > 0


def delete_session(session_id: str, db_path: Path = DEFAULT_DB_PATH) -> bool:
    conn = _get_conn(db_path)
    cur = conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    conn.commit()
    return cur.rowcount > 0
