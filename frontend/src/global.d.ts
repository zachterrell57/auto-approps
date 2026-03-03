import type {
  AppSettings,
  Client,
  ClientCreate,
  ClientUpdate,
  FieldMapping,
  FormSchema,
  KnowledgeProfile,
  MappingResult,
  SavedForm,
  SessionFull,
  SessionMeta,
  UploadResponse,
} from "./lib/types";

export interface ElectronAPI {
  upload(buffer: ArrayBuffer, filename: string, workflowId: string): Promise<UploadResponse>;
  getDocument(workflowId: string): Promise<{ buffer: ArrayBuffer; filename: string }>;
  getKnowledgeProfile(): Promise<KnowledgeProfile>;
  putKnowledgeProfile(args: {
    user_context: string;
    firm_context: string;
  }): Promise<KnowledgeProfile>;
  getSettings(): Promise<AppSettings>;
  putSettings(args: { anthropic_api_key: string }): Promise<AppSettings>;
  clearLocalData(): Promise<{ ok: boolean }>;
  scrape(args: { url: string; workflow_id: string }): Promise<FormSchema>;
  map(args: {
    workflow_id: string;
    client_id?: string;
    include_document?: boolean;
  }): Promise<MappingResult>;
  hydrateState(args: {
    workflow_id: string;
    form_schema: unknown;
    document_bytes?: ArrayBuffer | null;
    document_filename?: string | null;
  }): Promise<{ ok: boolean }>;
  listSavedForms(): Promise<SavedForm[]>;
  listSessions(): Promise<SessionMeta[]>;
  getSession(id: string): Promise<SessionFull>;
  getSessionDocument(
    id: string,
  ): Promise<{ buffer: ArrayBuffer; filename: string }>;
  createSession(args: {
    workflow_id: string;
    document_filename: string | null;
    form_url: string;
    form_title: string;
    form_provider: string;
    display_name?: string;
    form_schema: FormSchema;
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
