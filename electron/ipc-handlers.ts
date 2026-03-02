import { ipcMain } from "electron";
import * as ch from "./ipc-channels.js";
import state, { resetState } from "./services/state.js";
import { settings } from "./services/config.js";
import {
  readApiKey,
  writeApiKey,
  clearSettings,
} from "./services/settings-store.js";
import {
  listClients,
  getClient,
  createClient,
  updateClient,
  deleteClient,
  clearClients,
} from "./services/client-store.js";
import {
  loadKnowledgeProfile,
  saveKnowledgeProfile,
  clearKnowledgeProfile,
} from "./services/knowledge-store.js";
import { parseDocx } from "./services/doc-parser.js";
import { detectProvider } from "./services/provider.js";
import { scrapeForm } from "./services/form-scraper.js";
import { scrapeGenericForm } from "./services/generic-form-scraper.js";
import { scrapeMsForm } from "./services/ms-form-scraper.js";
import { mapFields } from "./services/mapper.js";
import { knowledgeProfileHasContent } from "./services/models.js";
import {
  listSessions,
  getSession,
  getSessionDocument,
  createSession,
  updateSessionMappings,
  renameSession,
  deleteSession,
  clearSessions,
} from "./services/session-store.js";
import { generateSessionName } from "./services/namer.js";

function maskKey(key: string): string {
  if (key.length <= 8) return key ? "*".repeat(key.length) : "";
  return key.slice(0, 7) + "..." + key.slice(-4);
}

function normalizeAndValidateFormUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Form URL is required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid form URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP(S) form URLs are supported.");
  }

  if (!parsed.hostname) {
    throw new Error("Invalid form URL host.");
  }

  return parsed.toString();
}

export function registerIpcHandlers(): void {
  // ── Upload document ──────────────────────────────────────────────────
  ipcMain.handle(
    ch.UPLOAD,
    async (_event, args: { buffer: ArrayBuffer; filename: string }) => {
      const buf = Buffer.from(args.buffer);
      if (!args.filename.toLowerCase().endsWith(".docx")) {
        throw new Error("Only .docx files are supported");
      }
      const parsed = await parseDocx(buf, args.filename);
      state.parsed_doc = parsed;
      state.raw_docx_bytes = buf;
      return {
        filename: parsed.filename,
        chunk_count: parsed.chunks.length,
        preview: parsed.full_text.slice(0, 500),
      };
    },
  );

  // ── Get document bytes ───────────────────────────────────────────────
  ipcMain.handle(ch.GET_DOCUMENT, async () => {
    if (!state.raw_docx_bytes) {
      throw new Error("No document uploaded");
    }
    return {
      buffer: state.raw_docx_bytes.buffer.slice(
        state.raw_docx_bytes.byteOffset,
        state.raw_docx_bytes.byteOffset + state.raw_docx_bytes.byteLength,
      ),
      filename: state.parsed_doc?.filename ?? "document.docx",
    };
  });

  // ── Knowledge profile ────────────────────────────────────────────────
  ipcMain.handle(ch.GET_KNOWLEDGE_PROFILE, async () => {
    return loadKnowledgeProfile();
  });

  ipcMain.handle(
    ch.PUT_KNOWLEDGE_PROFILE,
    async (
      _event,
      args: { user_context: string; firm_context: string },
    ) => {
      return saveKnowledgeProfile(args);
    },
  );

  // ── Settings ─────────────────────────────────────────────────────────
  ipcMain.handle(ch.GET_SETTINGS, async () => {
    const key = readApiKey();
    return {
      anthropic_api_key_set: Boolean(key),
      anthropic_api_key_preview: maskKey(key),
    };
  });

  ipcMain.handle(
    ch.PUT_SETTINGS,
    async (_event, args: { anthropic_api_key: string }) => {
      const key = args.anthropic_api_key.trim();
      writeApiKey(key);
      settings.anthropic_api_key = key;
      return {
        anthropic_api_key_set: Boolean(key),
        anthropic_api_key_preview: maskKey(key),
      };
    },
  );

  ipcMain.handle(ch.CLEAR_LOCAL_DATA, async () => {
    clearSettings();
    clearKnowledgeProfile();
    clearClients();
    clearSessions();
    resetState();
    settings.anthropic_api_key = "";
    return { ok: true };
  });

  // ── Scrape form ──────────────────────────────────────────────────────
  ipcMain.handle(ch.SCRAPE, async (_event, args: { url: string }) => {
    const normalizedUrl = normalizeAndValidateFormUrl(args.url);
    const provider = detectProvider(normalizedUrl);
    let schema;
    if (provider === "microsoft") {
      schema = await scrapeMsForm(normalizedUrl);
    } else if (provider === "generic") {
      schema = await scrapeGenericForm(normalizedUrl);
    } else {
      schema = await scrapeForm(normalizedUrl);
      schema.provider = "google";
    }
    state.form_schema = schema;
    return schema;
  });

  // ── Map fields ───────────────────────────────────────────────────────
  ipcMain.handle(
    ch.MAP,
    async (_event, args?: { client_id?: string; include_document?: boolean }) => {
      const includeDocument = args?.include_document ?? true;
      if (!state.form_schema) {
        throw new Error("No form scraped. Scrape a form first.");
      }

      const profile = loadKnowledgeProfile();
      const knowledgeProfile = knowledgeProfileHasContent(profile)
        ? profile
        : undefined;

      let clientKnowledge: string | undefined;
      if (args?.client_id) {
        const client = getClient(args.client_id);
        if (client && client.knowledge.trim()) {
          clientKnowledge = client.knowledge;
        }
      }

      const hasDocument = includeDocument && Boolean(state.parsed_doc);
      const hasClientKnowledge = Boolean(clientKnowledge?.trim());
      const hasProfileKnowledge = Boolean(
        knowledgeProfile?.user_context.trim() || knowledgeProfile?.firm_context.trim(),
      );
      if (!hasDocument && !hasClientKnowledge && !hasProfileKnowledge) {
        throw new Error(
          "No source context available. Upload a document, choose a client with saved knowledge, or add user/firm profile knowledge.",
        );
      }

      const result = await mapFields(
        hasDocument ? state.parsed_doc : null,
        state.form_schema,
        knowledgeProfile,
        clientKnowledge,
      );
      state.mapping_result = result;
      return result;
    },
  );

  // ── Sessions ─────────────────────────────────────────────────────────
  ipcMain.handle(ch.LIST_SESSIONS, async () => {
    return listSessions();
  });

  ipcMain.handle(ch.GET_SESSION, async (_event, args: { id: string }) => {
    const session = getSession(args.id);
    if (!session) throw new Error("Session not found");
    return session;
  });

  ipcMain.handle(
    ch.GET_SESSION_DOCUMENT,
    async (_event, args: { id: string }) => {
      const result = getSessionDocument(args.id);
      if (!result) throw new Error("No document for this session");
      return {
        buffer: result.documentBytes.buffer.slice(
          result.documentBytes.byteOffset,
          result.documentBytes.byteOffset + result.documentBytes.byteLength,
        ),
        filename: result.documentFilename,
      };
    },
  );

  ipcMain.handle(
    ch.CREATE_SESSION,
    async (
      _event,
      args: {
        document_filename: string | null;
        form_url: string;
        form_title: string;
        form_provider: string;
        display_name?: string;
        form_schema: Record<string, unknown>;
        mapping_result: Record<string, unknown>;
      },
    ) => {
      const includeDocument = Boolean(args.document_filename);
      if (includeDocument && !state.raw_docx_bytes) {
        throw new Error("Document metadata was provided, but no document is loaded.");
      }

      // Generate an AI session name via Haiku when no explicit name was given
      let displayName = args.display_name;
      if (!displayName) {
        const fields = (args.form_schema as { fields?: { label?: string }[] })
          .fields;
        const fieldLabels = fields
          ? fields.map((f) => f.label ?? "").filter(Boolean)
          : [];
        displayName = await generateSessionName({
          documentFilename: args.document_filename,
          formTitle: args.form_title,
          formFieldLabels: fieldLabels,
        });
      }

      return createSession({
        documentFilename: args.document_filename,
        documentBytes: includeDocument ? state.raw_docx_bytes : null,
        formUrl: args.form_url,
        formTitle: args.form_title,
        formProvider: args.form_provider,
        displayName,
        formSchema: args.form_schema,
        mappingResult: args.mapping_result,
      });
    },
  );

  ipcMain.handle(
    ch.UPDATE_SESSION_MAPPINGS,
    async (
      _event,
      args: { id: string; mappings: Record<string, unknown>[] },
    ) => {
      if (!updateSessionMappings(args.id, args.mappings)) {
        throw new Error("Session not found");
      }
      return { ok: true };
    },
  );

  ipcMain.handle(
    ch.RENAME_SESSION,
    async (
      _event,
      args: { id: string; display_name: string },
    ) => {
      const displayName = args.display_name.trim();
      if (!displayName) {
        throw new Error("Display name cannot be empty");
      }
      if (!renameSession(args.id, displayName)) {
        throw new Error("Session not found");
      }
      return { ok: true };
    },
  );

  ipcMain.handle(
    ch.DELETE_SESSION,
    async (_event, args: { id: string }) => {
      if (!deleteSession(args.id)) {
        throw new Error("Session not found");
      }
      return { ok: true };
    },
  );

  // ── Clients ─────────────────────────────────────────────────────────
  ipcMain.handle(ch.LIST_CLIENTS, async () => {
    return listClients();
  });

  ipcMain.handle(ch.GET_CLIENT, async (_event, args: { id: string }) => {
    const client = getClient(args.id);
    if (!client) throw new Error("Client not found");
    return client;
  });

  ipcMain.handle(
    ch.CREATE_CLIENT,
    async (_event, args: { name: string; knowledge?: string }) => {
      return createClient({ name: args.name, knowledge: args.knowledge ?? "" });
    },
  );

  ipcMain.handle(
    ch.UPDATE_CLIENT,
    async (
      _event,
      args: { id: string; name?: string; knowledge?: string },
    ) => {
      const updated = updateClient(args.id, {
        name: args.name,
        knowledge: args.knowledge,
      });
      if (!updated) throw new Error("Client not found");
      return updated;
    },
  );

  ipcMain.handle(
    ch.DELETE_CLIENT,
    async (_event, args: { id: string }) => {
      if (!deleteClient(args.id)) {
        throw new Error("Client not found");
      }
      return { ok: true };
    },
  );
}
