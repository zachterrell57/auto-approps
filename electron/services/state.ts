import type { ParsedDocument, TargetSchema, MappingResult } from "./models.js";

/**
 * Transient in-memory state for upload-scrape-map workflows.
 *
 * Each concurrent workflow is keyed by a client-generated workflow ID.
 * This replaces the previous global singleton so that multiple workflows
 * can run in parallel without overwriting each other's state.
 */

export interface AppState {
  source_document: ParsedDocument | null;
  source_document_bytes: Buffer | null;
  source_document_filename: string | null;
  target_schema: TargetSchema | null;
  target_document_bytes: Buffer | null;
  target_document_filename: string | null;
  mapping_result: MappingResult | null;
}

function createEmptyState(): AppState {
  return {
    source_document: null,
    source_document_bytes: null,
    source_document_filename: null,
    target_schema: null,
    target_document_bytes: null,
    target_document_filename: null,
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
