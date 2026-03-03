import type { ParsedDocument, FormSchema, MappingResult } from "./models.js";

/**
 * Transient in-memory state for upload-scrape-map workflows.
 *
 * Each concurrent workflow is keyed by a client-generated workflow ID.
 * This replaces the previous global singleton so that multiple workflows
 * can run in parallel without overwriting each other's state.
 */

export interface AppState {
  parsed_doc: ParsedDocument | null;
  raw_docx_bytes: Buffer | null;
  form_schema: FormSchema | null;
  mapping_result: MappingResult | null;
}

function createEmptyState(): AppState {
  return {
    parsed_doc: null,
    raw_docx_bytes: null,
    form_schema: null,
    mapping_result: null,
  };
}

// ---------------------------------------------------------------------------
// Workflow-keyed state store
// ---------------------------------------------------------------------------

const workflows = new Map<string, AppState>();

/** Get (or lazily create) state for a specific workflow. */
export function getWorkflow(workflowId: string): AppState {
  let wf = workflows.get(workflowId);
  if (!wf) {
    wf = createEmptyState();
    workflows.set(workflowId, wf);
  }
  return wf;
}

/** Remove a single workflow's state (e.g. after persisting to a session). */
export function deleteWorkflow(workflowId: string): void {
  workflows.delete(workflowId);
}

/** Clear all transient workflow state (e.g. when clearing local data). */
export function resetAllWorkflows(): void {
  workflows.clear();
}
