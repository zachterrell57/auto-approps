import type {
  AppSettings,
  Client,
  ClientCreate,
  ClientUpdate,
  FieldMapping,
  FormSchema,
  HearingClaim,
  HearingComment,
  HearingCreateInput,
  HearingExportFormat,
  HearingJob,
  HearingJobSummary,
  HearingOutput,
  HearingOutputType,
  HearingReviewStatus,
  HearingTranscriptSegment,
  HearingVerificationStatus,
  HearingWatchHit,
  HearingWatchItem,
  HearingWatchItemDraft,
  HearingWorkspace,
  KnowledgeProfile,
  KnowledgeProfileUpdate,
  MappingResult,
  SavedForm,
  SessionFull,
  SessionMeta,
  SettingsUpdate,
  UpdateStatus,
  UploadResponse,
} from "./types";

const api = window.electronAPI;

export async function uploadDocument(file: File, workflowId: string): Promise<UploadResponse> {
  const buffer = await file.arrayBuffer();
  return api.upload(buffer, file.name, workflowId);
}

export async function fetchDocumentBlob(workflowId: string): Promise<ArrayBuffer> {
  const result = await api.getDocument(workflowId);
  return result.buffer;
}

export async function prepareTargetFromUrl(
  url: string,
  workflowId: string,
): Promise<FormSchema> {
  return api.prepareTarget({ url, workflow_id: workflowId });
}

export async function prepareTargetFromFile(
  file: File,
  workflowId: string,
): Promise<FormSchema> {
  const buffer = await file.arrayBuffer();
  return api.prepareTarget({
    buffer,
    filename: file.name,
    workflow_id: workflowId,
  });
}

export async function downloadFilledTarget(
  workflowId: string,
  mappings: FieldMapping[],
): Promise<{ buffer: ArrayBuffer; filename: string }> {
  return api.downloadFilledTarget(workflowId, mappings);
}

export async function getKnowledgeProfile(): Promise<KnowledgeProfile> {
  return api.getKnowledgeProfile();
}

export async function saveKnowledgeProfile(
  payload: KnowledgeProfileUpdate,
): Promise<KnowledgeProfile> {
  return api.putKnowledgeProfile(payload);
}

export async function getSettings(): Promise<AppSettings> {
  return api.getSettings();
}

export async function saveSettings(
  payload: SettingsUpdate,
): Promise<AppSettings> {
  return api.putSettings(payload);
}

export async function clearLocalData(): Promise<void> {
  await api.clearLocalData();
}

export async function scrapeForm(url: string, workflowId: string): Promise<FormSchema> {
  return api.scrape({ url, workflow_id: workflowId });
}

export async function mapFields(args: {
  workflowId: string;
  clientId?: string;
  includeDocument?: boolean;
}): Promise<MappingResult> {
  return api.map({
    workflow_id: args.workflowId,
    client_id: args.clientId,
    include_document: args.includeDocument,
  });
}

export async function hydrateState(args: {
  workflowId: string;
  targetSchema: FormSchema;
  sourceDocumentBytes?: ArrayBuffer | null;
  sourceDocumentFilename?: string | null;
  targetDocumentBytes?: ArrayBuffer | null;
  targetDocumentFilename?: string | null;
}): Promise<void> {
  await api.hydrateState({
    workflow_id: args.workflowId,
    target_schema: args.targetSchema,
    source_document_bytes: args.sourceDocumentBytes,
    source_document_filename: args.sourceDocumentFilename,
    target_document_bytes: args.targetDocumentBytes,
    target_document_filename: args.targetDocumentFilename,
  });
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  await api.deleteWorkflow(workflowId);
}

export async function listClients(): Promise<Client[]> {
  return api.listClients();
}

export async function getClient(id: string): Promise<Client> {
  return api.getClient(id);
}

export async function createClient(data: ClientCreate): Promise<Client> {
  return api.createClient(data);
}

export async function updateClient(
  id: string,
  data: ClientUpdate,
): Promise<Client> {
  return api.updateClient(id, data);
}

export async function deleteClient(id: string): Promise<void> {
  return api.deleteClient(id);
}

export async function listHearingJobs(): Promise<HearingJobSummary[]> {
  return api.listHearingJobs();
}

export async function getHearingWorkspace(id: string): Promise<HearingWorkspace> {
  return api.getHearingWorkspace(id);
}

export async function createHearingJob(
  data: HearingCreateInput,
): Promise<HearingJob> {
  return api.createHearingJob(data);
}

export async function resolveHearingJob(id: string): Promise<HearingJob> {
  return api.resolveHearingJob(id);
}

export async function resolveHearingStream(id: string): Promise<HearingJob> {
  return api.resolveHearingStream(id);
}

export async function startHearingCapture(
  id: string,
  streamUrl?: string,
): Promise<HearingWorkspace> {
  return api.startHearingCapture(id, streamUrl);
}

export async function stopHearingCapture(id: string): Promise<HearingWorkspace> {
  return api.stopHearingCapture(id);
}

export async function getHearingCaptureStatus(id: string): Promise<HearingWorkspace> {
  return api.getHearingCaptureStatus(id);
}

export async function generateFinalHearingBrief(args: {
  hearing_job_id: string;
  output_type?: HearingOutputType;
  reviewer_instructions?: string;
  use_ai?: boolean;
}): Promise<HearingOutput> {
  return api.generateFinalHearingBrief(args);
}

export async function importHearingTranscript(args:
  | {
      hearing_job_id: string;
      text: string;
      filename?: string;
      source?: HearingTranscriptSegment["source"];
    }
  | { hearing_job_id: string; transcript_url: string }
  | { hearing_job_id: string; media_url: string }): Promise<HearingTranscriptSegment[]> {
  return api.importHearingTranscript(args);
}

export async function updateHearingWatchlist(
  id: string,
  watchItems: HearingWatchItemDraft[],
): Promise<HearingWatchItem[]> {
  return api.updateHearingWatchlist(id, watchItems);
}

export async function runHearingWatchlist(id: string): Promise<HearingWatchHit[]> {
  return api.runHearingWatchlist(id);
}

export async function generateHearingOutput(args: {
  hearing_job_id: string;
  output_type: HearingOutputType;
  reviewer_instructions?: string;
  use_ai?: boolean;
}): Promise<HearingOutput> {
  return api.generateHearingOutput(args);
}

export async function runHearingJob(args: {
  hearing_job_id: string;
  output_type?: HearingOutputType;
  reviewer_instructions?: string;
  use_ai?: boolean;
}): Promise<HearingOutput> {
  return api.runHearingJob(args);
}

export async function updateHearingReview(args: {
  segment_id?: string;
  segment_review_status?: HearingReviewStatus;
  speaker_label?: string;
  hit_id?: string;
  hit_status?: HearingWatchHit["status"];
  output_id?: string;
  output_markdown?: string;
  output_review_status?: HearingReviewStatus;
  claim_id?: string;
  claim_verification_status?: HearingVerificationStatus;
}): Promise<{
  segment?: HearingTranscriptSegment;
  hit?: HearingWatchHit;
  output?: HearingOutput;
  claim?: HearingClaim;
}> {
  return api.updateHearingReview(args);
}

export async function addHearingComment(args: {
  hearing_job_id: string;
  target_type: HearingComment["target_type"];
  target_id: string;
  comment: string;
}): Promise<HearingComment> {
  return api.addHearingComment(args);
}

export async function exportHearingResults(args: {
  hearing_job_id: string;
  format: HearingExportFormat;
  output_id?: string;
}): Promise<{ buffer: ArrayBuffer; filename: string; mime_type: string }> {
  return api.exportHearingResults(args);
}

export async function listSavedForms(): Promise<SavedForm[]> {
  return api.listSavedForms();
}

export async function listSessions(): Promise<SessionMeta[]> {
  return api.listSessions();
}

export async function getSession(id: string): Promise<SessionFull> {
  return api.getSession(id);
}

export async function createSession(data: {
  workflow_id: string;
  source_document_filename: string | null;
  target_kind: FormSchema["target_kind"];
  target_url: string;
  target_filename: string | null;
  target_title: string;
  target_provider: string;
  display_name?: string;
  target_schema: FormSchema;
  mapping_result: MappingResult;
}): Promise<SessionMeta> {
  return api.createSession(data);
}

export async function updateSessionMappings(
  id: string,
  mappings: FieldMapping[],
): Promise<void> {
  return api.updateSessionMappings(id, mappings);
}

export async function getSessionDocumentBytes(id: string): Promise<ArrayBuffer> {
  const result = await api.getSessionDocument(id);
  return result.buffer;
}

export async function getSessionDocumentBlobUrl(id: string): Promise<string> {
  const result = await api.getSessionDocument(id);
  const blob = new Blob([result.buffer], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  return URL.createObjectURL(blob);
}

export async function getSessionTargetDocumentBytes(id: string): Promise<ArrayBuffer> {
  const result = await api.getSessionTargetDocument(id);
  return result.buffer;
}

export async function renameSession(
  id: string,
  displayName: string,
): Promise<void> {
  return api.renameSession(id, displayName);
}

export async function deleteSession(id: string): Promise<void> {
  return api.deleteSession(id);
}

// ── Auto-update ──────────────────────────────────────────────────────────

/** Subscribe to update status events pushed from the main process.
 *  Returns an unsubscribe function. */
export function onUpdateStatus(
  callback: (status: UpdateStatus) => void,
): () => void {
  return api.onUpdateStatus(callback as (s: unknown) => void);
}

export async function installUpdate(): Promise<void> {
  await api.installUpdate();
}

export async function checkForUpdate(): Promise<void> {
  await api.checkForUpdate();
}

export async function getAppVersion(): Promise<string> {
  const result = await api.getAppVersion();
  return result.version;
}
