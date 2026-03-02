// ---------------------------------------------------------------------------
// client-store.ts — Load / save clients
//
// Clients are stored as a JSON array in `<userData>/clients.json`.
// Follows the same atomic-write pattern as knowledge-store.ts.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";

import { getUserDataPath } from "./config";
import { atomicWriteJsonSync } from "./json-store";
import {
  ClientSchema,
  type Client,
  type ClientCreate,
  type ClientUpdate,
} from "./models";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clientsPath(): string {
  return path.join(getUserDataPath(), "clients.json");
}

function loadAll(): Client[] {
  try {
    const raw: unknown = JSON.parse(
      fs.readFileSync(clientsPath(), "utf-8"),
    );
    if (!Array.isArray(raw)) return [];
    const clients: Client[] = [];
    for (const item of raw) {
      try {
        clients.push(ClientSchema.parse(item));
      } catch {
        // skip invalid entries
      }
    }
    return clients;
  } catch {
    return [];
  }
}

function saveAll(clients: Client[]): void {
  atomicWriteJsonSync(clientsPath(), clients);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function listClients(): Client[] {
  return loadAll();
}

export function getClient(id: string): Client | null {
  const clients = loadAll();
  return clients.find((c) => c.id === id) ?? null;
}

export function createClient(data: ClientCreate): Client {
  const clients = loadAll();
  const now = new Date().toISOString();
  const client: Client = {
    id: uuidv4(),
    name: data.name,
    knowledge: data.knowledge ?? "",
    created_at: now,
    updated_at: now,
  };
  clients.push(client);
  saveAll(clients);
  return client;
}

export function updateClient(id: string, data: ClientUpdate): Client | null {
  const clients = loadAll();
  const idx = clients.findIndex((c) => c.id === id);
  if (idx === -1) return null;

  const existing = clients[idx];
  const updated: Client = {
    ...existing,
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.knowledge !== undefined ? { knowledge: data.knowledge } : {}),
    updated_at: new Date().toISOString(),
  };
  clients[idx] = updated;
  saveAll(clients);
  return updated;
}

export function deleteClient(id: string): boolean {
  const clients = loadAll();
  const filtered = clients.filter((c) => c.id !== id);
  if (filtered.length === clients.length) return false;
  saveAll(filtered);
  return true;
}

export function clearClients(): void {
  try {
    fs.unlinkSync(clientsPath());
  } catch {
    // Best-effort cleanup.
  }
}
