// ---------------------------------------------------------------------------
// settings-store.ts — Read / write the API key in settings.json
//
// Port of backend/src/auto_approps/settings_store.py.
// Instead of parsing a .env file, this module reads and writes a JSON file
// located at `<userData>/settings.json`.  Writes are atomic (write to a .tmp
// file then rename) so a crash mid-write cannot corrupt the file.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

import { getUserDataPath } from "./config";
import { atomicWriteJsonSync } from "./json-store";

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
