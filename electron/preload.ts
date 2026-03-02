import { contextBridge, ipcRenderer } from "electron";
import * as ch from "./ipc-channels.js";

contextBridge.exposeInMainWorld("electronAPI", {
  upload: (buffer: ArrayBuffer, filename: string) =>
    ipcRenderer.invoke(ch.UPLOAD, { buffer, filename }),

  getDocument: () => ipcRenderer.invoke(ch.GET_DOCUMENT),

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

  scrape: (args: { url: string }) =>
    ipcRenderer.invoke(ch.SCRAPE, args),

  map: (args?: { client_id?: string }) =>
    ipcRenderer.invoke(ch.MAP, args),

  listSessions: () => ipcRenderer.invoke(ch.LIST_SESSIONS),

  getSession: (id: string) =>
    ipcRenderer.invoke(ch.GET_SESSION, { id }),

  getSessionDocument: (id: string) =>
    ipcRenderer.invoke(ch.GET_SESSION_DOCUMENT, { id }),

  createSession: (args: {
    document_filename: string;
    form_url: string;
    form_title: string;
    form_provider: string;
    display_name?: string;
    form_schema: unknown;
    mapping_result: unknown;
  }) => ipcRenderer.invoke(ch.CREATE_SESSION, args),

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
});
