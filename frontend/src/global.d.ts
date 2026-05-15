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
  MappingResult,
  SavedForm,
  SessionFull,
  SessionMeta,
  TargetKind,
  UploadResponse,
} from "./lib/types";

export interface ElectronAPI {
  upload(buffer: ArrayBuffer, filename: string, workflowId: string): Promise<UploadResponse>;
  getDocument(workflowId: string): Promise<{ buffer: ArrayBuffer; filename: string }>;
  prepareTarget(
    args:
      | { workflow_id: string; url: string }
      | { workflow_id: string; buffer: ArrayBuffer; filename: string },
  ): Promise<FormSchema>;
  getTargetDocument(workflowId: string): Promise<{ buffer: ArrayBuffer; filename: string }>;
  downloadFilledTarget(
    workflowId: string,
    mappings: FieldMapping[],
  ): Promise<{ buffer: ArrayBuffer; filename: string }>;
  getKnowledgeProfile(): Promise<KnowledgeProfile>;
  putKnowledgeProfile(args: {
    user_context: string;
    firm_context: string;
  }): Promise<KnowledgeProfile>;
  getSettings(): Promise<AppSettings>;
  putSettings(args: { anthropic_api_key?: string; openai_api_key?: string }): Promise<AppSettings>;
  clearLocalData(): Promise<{ ok: boolean }>;
  scrape(args: { url: string; workflow_id: string }): Promise<FormSchema>;
  map(args: {
    workflow_id: string;
    client_id?: string;
    include_document?: boolean;
  }): Promise<MappingResult>;
  hydrateState(args: {
    workflow_id: string;
    target_schema: unknown;
    source_document_bytes?: ArrayBuffer | null;
    source_document_filename?: string | null;
    target_document_bytes?: ArrayBuffer | null;
    target_document_filename?: string | null;
  }): Promise<{ ok: boolean }>;
  listSavedForms(): Promise<SavedForm[]>;
  listSessions(): Promise<SessionMeta[]>;
  getSession(id: string): Promise<SessionFull>;
  getSessionDocument(
    id: string,
  ): Promise<{ buffer: ArrayBuffer; filename: string }>;
  getSessionTargetDocument(
    id: string,
  ): Promise<{ buffer: ArrayBuffer; filename: string }>;
  createSession(args: {
    workflow_id: string;
    source_document_filename: string | null;
    target_kind: TargetKind;
    target_url: string;
    target_filename: string | null;
    target_title: string;
    target_provider: string;
    display_name?: string;
    target_schema: FormSchema;
    mapping_result: MappingResult;
  }): Promise<SessionMeta>;
  updateSessionMappings(
    id: string,
    mappings: FieldMapping[],
  ): Promise<void>;
  renameSession(id: string, displayName: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
  deleteWorkflow(workflowId: string): Promise<{ ok: boolean }>;
  listClients(): Promise<Client[]>;
  getClient(id: string): Promise<Client>;
  createClient(data: ClientCreate): Promise<Client>;
  updateClient(id: string, data: ClientUpdate): Promise<Client>;
  deleteClient(id: string): Promise<void>;
  listHearingJobs(): Promise<HearingJobSummary[]>;
  getHearingWorkspace(id: string): Promise<HearingWorkspace>;
  createHearingJob(args: HearingCreateInput): Promise<HearingJob>;
  resolveHearingJob(id: string): Promise<HearingJob>;
  resolveHearingStream(id: string): Promise<HearingJob>;
  startHearingCapture(id: string, streamUrl?: string): Promise<HearingWorkspace>;
  stopHearingCapture(id: string): Promise<HearingWorkspace>;
  getHearingCaptureStatus(id: string): Promise<HearingWorkspace>;
  generateFinalHearingBrief(args: {
    hearing_job_id: string;
    output_type?: HearingOutputType;
    reviewer_instructions?: string;
    use_ai?: boolean;
  }): Promise<HearingOutput>;
  importHearingTranscript(args:
    | {
        hearing_job_id: string;
        text: string;
        filename?: string;
        source?: HearingTranscriptSegment["source"];
      }
    | { hearing_job_id: string; transcript_url: string }
    | { hearing_job_id: string; media_url: string }): Promise<HearingTranscriptSegment[]>;
  updateHearingWatchlist(
    id: string,
    watchItems: HearingWatchItemDraft[],
  ): Promise<HearingWatchItem[]>;
  runHearingWatchlist(id: string): Promise<HearingWatchHit[]>;
  generateHearingOutput(args: {
    hearing_job_id: string;
    output_type: HearingOutputType;
    reviewer_instructions?: string;
    use_ai?: boolean;
  }): Promise<HearingOutput>;
  runHearingJob(args: {
    hearing_job_id: string;
    output_type?: HearingOutputType;
    reviewer_instructions?: string;
    use_ai?: boolean;
  }): Promise<HearingOutput>;
  updateHearingReview(args: {
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
  }>;
  addHearingComment(args: {
    hearing_job_id: string;
    target_type: HearingComment["target_type"];
    target_id: string;
    comment: string;
  }): Promise<HearingComment>;
  exportHearingResults(args: {
    hearing_job_id: string;
    format: HearingExportFormat;
    output_id?: string;
  }): Promise<{ buffer: ArrayBuffer; filename: string; mime_type: string }>;

  // App updates
  onUpdateStatus(callback: (status: unknown) => void): () => void;
  installUpdate(): Promise<void>;
  checkForUpdate(): Promise<void>;
  getAppVersion(): Promise<{ version: string }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
