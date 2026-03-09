// ---------------------------------------------------------------------------
// settings-store.ts — Read / write the API key in settings.json
//
// Reads and writes a JSON file located at `<userData>/settings.json`.  Writes
// are atomic (write to a .tmp file then rename) so a crash mid-write cannot
// corrupt the file.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

import { getUserDataPath } from "./config";
import { atomicWriteJsonSync } from "./json-store";

export interface GoogleOAuthSettings {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  token_type?: string;
  id_token?: string;
  email?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function settingsPath(): string {
  return path.join(getUserDataPath(), "settings.json");
}

/**
 * Read the full settings.json object, returning an empty object on any error.
 */
function readSettingsFile(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the Anthropic API key from settings.json.
 * Returns an empty string if the file does not exist or the key is absent.
 */
export function readApiKey(): string {
  const data = readSettingsFile();
  const key = data.anthropic_api_key;
  return typeof key === "string" ? key : "";
}

/**
 * Write (or update) the Anthropic API key in settings.json, preserving any
 * other keys that may be present in the file.
 */
export function writeApiKey(apiKey: string): void {
  const data = readSettingsFile();
  data.anthropic_api_key = apiKey;
  atomicWriteJsonSync(settingsPath(), data);
}

export function readGoogleOAuth(): GoogleOAuthSettings | null {
  const data = readSettingsFile().google_oauth;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const record = data as Record<string, unknown>;
  if (
    typeof record.access_token !== "string" ||
    typeof record.refresh_token !== "string" ||
    typeof record.expires_at !== "number" ||
    typeof record.scope !== "string"
  ) {
    return null;
  }
  return {
    access_token: record.access_token,
    refresh_token: record.refresh_token,
    expires_at: record.expires_at,
    scope: record.scope,
    token_type: typeof record.token_type === "string" ? record.token_type : undefined,
    id_token: typeof record.id_token === "string" ? record.id_token : undefined,
    email: typeof record.email === "string" ? record.email : undefined,
  };
}

export function writeGoogleOAuth(token: GoogleOAuthSettings): void {
  const data = readSettingsFile();
  data.google_oauth = token;
  atomicWriteJsonSync(settingsPath(), data);
}

export function clearGoogleOAuth(): void {
  const data = readSettingsFile();
  if (!("google_oauth" in data)) return;
  delete data.google_oauth;
  atomicWriteJsonSync(settingsPath(), data);
}

export function clearSettings(): void {
  try {
    fs.unlinkSync(settingsPath());
  } catch {
    // Best-effort cleanup.
  }
}
