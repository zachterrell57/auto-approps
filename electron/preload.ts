import { contextBridge, ipcRenderer } from "electron";
import * as ch from "./ipc-channels.js";

contextBridge.exposeInMainWorld("electronAPI", {
  upload: (buffer: ArrayBuffer, filename: string, workflowId: string) =>
    ipcRenderer.invoke(ch.UPLOAD, { buffer, filename, workflow_id: workflowId }),

  getDocument: (workflowId: string) =>
    ipcRenderer.invoke(ch.GET_DOCUMENT, { workflow_id: workflowId }),

  prepareTarget: (args: { workflow_id: string; url: string } | { workflow_id: string; buffer: ArrayBuffer; filename: string }) =>
    ipcRenderer.invoke(ch.PREPARE_TARGET, args),

  getTargetDocument: (workflowId: string) =>
    ipcRenderer.invoke(ch.GET_TARGET_DOCUMENT, { workflow_id: workflowId }),

  downloadFilledTarget: (workflowId: string, mappings: unknown[]) =>
    ipcRenderer.invoke(ch.DOWNLOAD_FILLED_TARGET, {
      workflow_id: workflowId,
      mappings,
    }),

  getKnowledgeProfile: () =>
    ipcRenderer.invoke(ch.GET_KNOWLEDGE_PROFILE),

  putKnowledgeProfile: (args: {
    user_context: string;
    firm_context: string;
  }) => ipcRenderer.invoke(ch.PUT_KNOWLEDGE_PROFILE, args),

  getSettings: () => ipcRenderer.invoke(ch.GET_SETTINGS),

  putSettings: (args: { anthropic_api_key: string }) =>
    ipcRenderer.invoke(ch.PUT_SETTINGS, args),

  clearLocalData: () =>
    ipcRenderer.invoke(ch.CLEAR_LOCAL_DATA),

  scrape: (args: { url: string; workflow_id: string }) =>
    ipcRenderer.invoke(ch.SCRAPE, args),

  map: (args: { workflow_id: string; client_id?: string; include_document?: boolean }) =>
    ipcRenderer.invoke(ch.MAP, args),

  hydrateState: (args: {
    workflow_id: string;
    target_schema: unknown;
    source_document_bytes?: ArrayBuffer | null;
    source_document_filename?: string | null;
    target_document_bytes?: ArrayBuffer | null;
    target_document_filename?: string | null;
  }) => ipcRenderer.invoke(ch.HYDRATE_STATE, args),

  listSavedForms: () => ipcRenderer.invoke(ch.LIST_SAVED_FORMS),

  listSessions: () => ipcRenderer.invoke(ch.LIST_SESSIONS),

  getSession: (id: string) =>
    ipcRenderer.invoke(ch.GET_SESSION, { id }),

  getSessionDocument: (id: string) =>
    ipcRenderer.invoke(ch.GET_SESSION_DOCUMENT, { id }),

  getSessionTargetDocument: (id: string) =>
    ipcRenderer.invoke(ch.GET_SESSION_TARGET_DOCUMENT, { id }),

  createSession: (args: {
    workflow_id: string;
    source_document_filename: string | null;
    target_kind: string;
    target_url: string;
    target_filename: string | null;
    target_title: string;
    target_provider: string;
    display_name?: string;
    target_schema: unknown;
    mapping_result: unknown;
  }) => ipcRenderer.invoke(ch.CREATE_SESSION, args),

  deleteWorkflow: (workflowId: string) =>
    ipcRenderer.invoke(ch.DELETE_WORKFLOW, { workflow_id: workflowId }),

  updateSessionMappings: (id: string, mappings: unknown[]) =>
    ipcRenderer.invoke(ch.UPDATE_SESSION_MAPPINGS, { id, mappings }),

  renameSession: (id: string, displayName: string) =>
    ipcRenderer.invoke(ch.RENAME_SESSION, {
      id,
      display_name: displayName,
    }),

  deleteSession: (id: string) =>
    ipcRenderer.invoke(ch.DELETE_SESSION, { id }),

  listClients: () => ipcRenderer.invoke(ch.LIST_CLIENTS),

  getClient: (id: string) =>
    ipcRenderer.invoke(ch.GET_CLIENT, { id }),

  createClient: (args: { name: string; knowledge?: string }) =>
    ipcRenderer.invoke(ch.CREATE_CLIENT, args),

  updateClient: (id: string, args: { name?: string; knowledge?: string }) =>
    ipcRenderer.invoke(ch.UPDATE_CLIENT, { id, ...args }),

  deleteClient: (id: string) =>
    ipcRenderer.invoke(ch.DELETE_CLIENT, { id }),

  // ── App updates ─────────────────────────────────────────────────────
  onUpdateStatus: (callback: (status: unknown) => void) => {
    const handler = (_event: unknown, status: unknown) => callback(status);
    ipcRenderer.on(ch.UPDATE_STATUS, handler);
    return () => {
      ipcRenderer.removeListener(ch.UPDATE_STATUS, handler);
    };
  },

  installUpdate: () => ipcRenderer.invoke(ch.INSTALL_UPDATE),

  checkForUpdate: () => ipcRenderer.invoke(ch.CHECK_FOR_UPDATE),

  getAppVersion: () =>
    ipcRenderer.invoke(ch.GET_APP_VERSION) as Promise<{ version: string }>,
});
