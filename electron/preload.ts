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

  scrape: (args: { url: string }) =>
    ipcRenderer.invoke(ch.SCRAPE, args),

  map: () => ipcRenderer.invoke(ch.MAP),

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
    form_schema: unknown;
    mapping_result: unknown;
  }) => ipcRenderer.invoke(ch.CREATE_SESSION, args),

  updateSessionMappings: (id: string, mappings: unknown[]) =>
    ipcRenderer.invoke(ch.UPDATE_SESSION_MAPPINGS, { id, mappings }),

  deleteSession: (id: string) =>
    ipcRenderer.invoke(ch.DELETE_SESSION, { id }),
});
