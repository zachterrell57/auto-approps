import type { ParsedDocument, FormSchema, MappingResult } from "./models.js";

/**
 * Transient in-memory state that lives for the duration of a single
 * upload-scrape-map workflow.
 *
 * This module is intentionally a plain object rather than a class so that
 * every module that imports it shares the same singleton reference.
 */

export interface AppState {
  parsed_doc: ParsedDocument | null;
  raw_docx_bytes: Buffer | null;
  form_schema: FormSchema | null;
  mapping_result: MappingResult | null;
}

const state: AppState = {
  parsed_doc: null,
  raw_docx_bytes: null,
  form_schema: null,
  mapping_result: null,
};

export default state;

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/** Reset all transient state (e.g. when starting a fresh workflow). */
export function resetState(): void {
  state.parsed_doc = null;
  state.raw_docx_bytes = null;
  state.form_schema = null;
  state.mapping_result = null;
}
