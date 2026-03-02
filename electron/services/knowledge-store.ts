// ---------------------------------------------------------------------------
// knowledge-store.ts — Load / save the knowledge profile
//
// Port of backend/src/auto_approps/knowledge_profile_store.py.
// The profile is persisted as `<userData>/knowledge_profile.json`.  Writes
// are atomic (write to .tmp then rename).
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

import { getUserDataPath } from "./config";
import { atomicWriteJsonSync } from "./json-store";
import {
  KnowledgeProfileSchema,
  type KnowledgeProfile,
  type KnowledgeProfileUpdate,
} from "./models";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function profilePath(): string {
  return path.join(getUserDataPath(), "knowledge_profile.json");
}

function defaultProfile(): KnowledgeProfile {
  return KnowledgeProfileSchema.parse({});
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load the knowledge profile from disk.
 *
 * Returns a default (empty) profile when:
 *  - the file does not exist
 *  - the file contains invalid JSON
 *  - the JSON payload fails zod validation
 */
export function loadKnowledgeProfile(): KnowledgeProfile {
  try {
    const raw: unknown = JSON.parse(
      fs.readFileSync(profilePath(), "utf-8"),
    );
    return KnowledgeProfileSchema.parse(raw);
  } catch {
    // Any I/O, JSON-parse, or validation error → fall back to defaults.
    return defaultProfile();
  }
}

/**
 * Save a knowledge profile update to disk and return the full persisted
 * profile (including the generated `updated_at` timestamp).
 */
export function saveKnowledgeProfile(
  update: KnowledgeProfileUpdate,
): KnowledgeProfile {
  const profile: KnowledgeProfile = {
    user_context: update.user_context,
    firm_context: update.firm_context,
    updated_at: new Date().toISOString(),
  };

  atomicWriteJsonSync(profilePath(), profile);
  return profile;
}

export function clearKnowledgeProfile(): void {
  try {
    fs.unlinkSync(profilePath());
  } catch {
    // Best-effort cleanup.
  }
}
