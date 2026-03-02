import type {
  AppSettings,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export async function uploadDocument(file: File): Promise<UploadResponse> {
  const api = electron();
  if (api) {
    const buffer = await file.arrayBuffer();
    return api.upload(buffer, file.name);
  }
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/api/upload`, { method: "POST", body: form });
  return handleResponse(res);
}

export async function fetchDocumentBlob(): Promise<ArrayBuffer> {
  const api = electron();
  if (api) {
    const result = await api.getDocument();
    return result.buffer;
  }
  const res = await fetch(`${BASE}/api/document`);
  if (!res.ok) throw new Error("Failed to fetch document");
  return res.arrayBuffer();
}

// ---------------------------------------------------------------------------
// Knowledge profile
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Scrape & map
// ---------------------------------------------------------------------------

export async function scrapeForm(url: string): Promise<FormSchema> {
  const api = electron();
  if (api) return api.scrape({ url });
  const res = await fetch(`${BASE}/api/scrape`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return handleResponse(res);
}

export async function mapFields(): Promise<MappingResult> {
  const api = electron();
  if (api) return api.map();
  const res = await fetch(`${BASE}/api/map`, { method: "POST" });
  return handleResponse(res);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

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
  document_filename: string;
  form_url: string;
  form_title: string;
  form_provider: string;
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

export async function deleteSession(id: string): Promise<void> {
  const api = electron();
  if (api) return api.deleteSession(id);
  const res = await fetch(`${BASE}/api/sessions/${id}`, {
    method: "DELETE",
  });
  await handleResponse(res);
}
