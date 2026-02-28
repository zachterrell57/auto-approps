import type { FormSchema, MappingResult, UploadResponse } from "./types";

const BASE = "";

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

export async function uploadDocument(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/api/upload`, { method: "POST", body: form });
  return handleResponse(res);
}

export async function scrapeForm(url: string): Promise<FormSchema> {
  const res = await fetch(`${BASE}/api/scrape`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return handleResponse(res);
}

export async function mapFields(): Promise<MappingResult> {
  const res = await fetch(`${BASE}/api/map`, { method: "POST" });
  return handleResponse(res);
}
