import type {
  AppSettings,
  Client,
  ClientCreate,
  ClientUpdate,
  FieldMapping,
  FormSchema,
  KnowledgeProfile,
  KnowledgeProfileUpdate,
  MappingResult,
  SessionFull,
  SessionMeta,
  SettingsUpdate,
  UploadResponse,
} from "./types";

const BASE = "";
const electron = () => window.electronAPI;

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    let message: string;
    try {
      message = JSON.parse(body).detail ?? body;
    } catch {
      message = body;
    }
    throw new Error(message);
  }
  return res.json();
}

export async function uploadDocument(file: File, workflowId: string): Promise<UploadResponse> {
  const api = electron();
  if (api) {
    const buffer = await file.arrayBuffer();
    return api.upload(buffer, file.name, workflowId);
  }
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/api/upload`, { method: "POST", body: form });
  return handleResponse(res);
}

export async function fetchDocumentBlob(workflowId: string): Promise<ArrayBuffer> {
  const api = electron();
  if (api) {
    const result = await api.getDocument(workflowId);
    return result.buffer;
  }
  const res = await fetch(`${BASE}/api/document`);
  if (!res.ok) throw new Error("Failed to fetch document");
  return res.arrayBuffer();
}

export async function getKnowledgeProfile(): Promise<KnowledgeProfile> {
  const api = electron();
  if (api) return api.getKnowledgeProfile();
  const res = await fetch(`${BASE}/api/knowledge-profile`);
  return handleResponse(res);
}

export async function saveKnowledgeProfile(
  payload: KnowledgeProfileUpdate,
): Promise<KnowledgeProfile> {
  const api = electron();
  if (api) return api.putKnowledgeProfile(payload);
  const res = await fetch(`${BASE}/api/knowledge-profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function getSettings(): Promise<AppSettings> {
  const api = electron();
  if (api) return api.getSettings();
  const res = await fetch(`${BASE}/api/settings`);
  return handleResponse(res);
}

export async function saveSettings(
  payload: SettingsUpdate,
): Promise<AppSettings> {
  const api = electron();
  if (api) return api.putSettings(payload);
  const res = await fetch(`${BASE}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function clearLocalData(): Promise<void> {
  const api = electron();
  if (api) {
    await api.clearLocalData();
    return;
  }
  const res = await fetch(`${BASE}/api/settings/clear-local-data`, {
    method: "POST",
  });
  await handleResponse(res);
}

export async function scrapeForm(url: string, workflowId: string): Promise<FormSchema> {
  const api = electron();
  if (api) return api.scrape({ url, workflow_id: workflowId });
  const res = await fetch(`${BASE}/api/scrape`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return handleResponse(res);
}

export async function mapFields(args: {
  workflowId: string;
  clientId?: string;
  includeDocument?: boolean;
}): Promise<MappingResult> {
  const api = electron();
  if (api) {
    return api.map({
      workflow_id: args.workflowId,
      client_id: args.clientId,
      include_document: args.includeDocument,
    });
  }
  const params = new URLSearchParams();
  if (args.clientId) {
    params.set("client_id", args.clientId);
  }
  if (typeof args.includeDocument === "boolean") {
    params.set("include_document", String(args.includeDocument));
  }
  const query = params.toString();
  const url = query ? `${BASE}/api/map?${query}` : `${BASE}/api/map`;
  const res = await fetch(url, { method: "POST" });
  return handleResponse(res);
}

export async function hydrateState(args: {
  workflowId: string;
  formSchema: FormSchema;
  documentBytes?: ArrayBuffer | null;
  documentFilename?: string | null;
}): Promise<void> {
  const api = electron();
  if (api) {
    await api.hydrateState({
      workflow_id: args.workflowId,
      form_schema: args.formSchema,
      document_bytes: args.documentBytes,
      document_filename: args.documentFilename,
    });
    return;
  }
  // fetch fallback not needed — hydration is Electron-only
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  const api = electron();
  if (api) {
    await api.deleteWorkflow(workflowId);
    return;
  }
  // fetch fallback not needed — workflow cleanup is Electron-only
}

export async function listClients(): Promise<Client[]> {
  const api = electron();
  if (api) return api.listClients();
  const res = await fetch(`${BASE}/api/clients`);
  return handleResponse(res);
}

export async function getClient(id: string): Promise<Client> {
  const api = electron();
  if (api) return api.getClient(id);
  const res = await fetch(`${BASE}/api/clients/${id}`);
  return handleResponse(res);
}

export async function createClient(data: ClientCreate): Promise<Client> {
  const api = electron();
  if (api) return api.createClient(data);
  const res = await fetch(`${BASE}/api/clients`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function updateClient(
  id: string,
  data: ClientUpdate,
): Promise<Client> {
  const api = electron();
  if (api) return api.updateClient(id, data);
  const res = await fetch(`${BASE}/api/clients/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function deleteClient(id: string): Promise<void> {
  const api = electron();
  if (api) return api.deleteClient(id);
  const res = await fetch(`${BASE}/api/clients/${id}`, {
    method: "DELETE",
  });
  await handleResponse(res);
}

export async function listSessions(): Promise<SessionMeta[]> {
  const api = electron();
  if (api) return api.listSessions();
  const res = await fetch(`${BASE}/api/sessions`);
  return handleResponse(res);
}

export async function getSession(id: string): Promise<SessionFull> {
  const api = electron();
  if (api) return api.getSession(id);
  const res = await fetch(`${BASE}/api/sessions/${id}`);
  return handleResponse(res);
}

export async function createSession(data: {
  workflow_id: string;
  document_filename: string | null;
  form_url: string;
  form_title: string;
  form_provider: string;
  display_name?: string;
  form_schema: FormSchema;
  mapping_result: MappingResult;
}): Promise<SessionMeta> {
  const api = electron();
  if (api) return api.createSession(data);
  const res = await fetch(`${BASE}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function updateSessionMappings(
  id: string,
  mappings: FieldMapping[],
): Promise<void> {
  const api = electron();
  if (api) return api.updateSessionMappings(id, mappings);
  const res = await fetch(`${BASE}/api/sessions/${id}/mappings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mappings }),
  });
  await handleResponse(res);
}

export async function getSessionDocumentBytes(id: string): Promise<ArrayBuffer> {
  const api = electron();
  if (api) {
    const result = await api.getSessionDocument(id);
    return result.buffer;
  }
  const res = await fetch(`${BASE}/api/sessions/${id}/document`);
  if (!res.ok) throw new Error("Failed to fetch session document");
  return res.arrayBuffer();
}

export async function getSessionDocumentBlobUrl(id: string): Promise<string> {
  const api = electron();
  if (api) {
    const result = await api.getSessionDocument(id);
    const blob = new Blob([result.buffer], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    return URL.createObjectURL(blob);
  }
  const res = await fetch(`${BASE}/api/sessions/${id}/document`);
  if (!res.ok) throw new Error("Failed to fetch session document");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function renameSession(
  id: string,
  displayName: string,
): Promise<void> {
  const api = electron();
  if (api) return api.renameSession(id, displayName);
  const res = await fetch(`${BASE}/api/sessions/${id}/name`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: displayName }),
  });
  await handleResponse(res);
}

export async function deleteSession(id: string): Promise<void> {
  const api = electron();
  if (api) return api.deleteSession(id);
  const res = await fetch(`${BASE}/api/sessions/${id}`, {
    method: "DELETE",
  });
  await handleResponse(res);
}
