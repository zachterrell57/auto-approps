import type {
  AppSettings,
  FormSchema,
  KnowledgeProfile,
  MappingResult,
  SessionFull,
  SessionMeta,
  UploadResponse,
} from "./lib/types";

export interface ElectronAPI {
  upload(buffer: ArrayBuffer, filename: string): Promise<UploadResponse>;
  getDocument(): Promise<{ buffer: ArrayBuffer; filename: string }>;
  getKnowledgeProfile(): Promise<KnowledgeProfile>;
  putKnowledgeProfile(args: {
    user_context: string;
    firm_context: string;
  }): Promise<KnowledgeProfile>;
  getSettings(): Promise<AppSettings>;
  putSettings(args: { anthropic_api_key: string }): Promise<AppSettings>;
  scrape(args: { url: string }): Promise<FormSchema>;
  map(): Promise<MappingResult>;
  listSessions(): Promise<SessionMeta[]>;
  getSession(id: string): Promise<SessionFull>;
  getSessionDocument(
    id: string,
  ): Promise<{ buffer: ArrayBuffer; filename: string }>;
  createSession(args: {
    document_filename: string;
    form_url: string;
    form_title: string;
    form_provider: string;
    form_schema: FormSchema;
    mapping_result: MappingResult;
  }): Promise<SessionMeta>;
  updateSessionMappings(
    id: string,
    mappings: unknown[],
  ): Promise<void>;
  deleteSession(id: string): Promise<void>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
