import { app, autoUpdater, BrowserWindow, ipcMain } from "electron";
import * as ch from "./ipc-channels.js";
import { UPDATE_STATUS } from "./ipc-channels.js";
import { getWorkflow, deleteWorkflow, resetAllWorkflows } from "./services/state.js";
import { settings } from "./services/config.js";
import {
  readApiKey,
  readOpenAiApiKey,
  writeApiKey,
  writeOpenAiApiKey,
  clearSettings,
} from "./services/settings-store.js";
import { getMediaToolStatuses } from "./services/media-tools.js";
import {
  listClients,
  getClient,
  createClient,
  updateClient,
  deleteClient,
  clearClients,
} from "./services/client-store.js";
import {
  addHearingReviewComment,
  createHearingIntelligenceJob,
  exportHearingIntelligence,
  fetchAndImportHearingTranscript,
  generateFinalHearingIntelligenceBrief,
  generateHearingIntelligenceOutput,
  getHearingIntelligenceCaptureStatus,
  getHearingIntelligenceWorkspace,
  importHearingTranscript,
  listHearingIntelligenceJobs,
  resolveHearingIntelligenceJob,
  resolveHearingIntelligenceStream,
  runHearingIntelligenceJob,
  runHearingWatchlist,
  saveHearingWatchItems,
  startHearingIntelligenceCapture,
  stopHearingIntelligenceCapture,
  transcribeAndImportHearingMedia,
  updateHearingReview,
} from "./services/hearing-intelligence.js";
import { clearHearings } from "./services/hearing-store.js";
import {
  loadKnowledgeProfile,
  saveKnowledgeProfile,
  clearKnowledgeProfile,
} from "./services/knowledge-store.js";
import { parseDocx } from "./services/doc-parser.js";
import { mapFields } from "./services/mapper.js";
import { knowledgeProfileHasContent } from "./services/models.js";
import {
  listSavedForms,
  listSessions,
  getSession,
  getSessionDocument,
  getSessionTargetDocument,
  createSession,
  updateSessionMappings,
  renameSession,
  deleteSession,
  clearSessions,
} from "./services/session-store.js";
import { generateSessionName } from "./services/namer.js";
import { prepareFileTarget, prepareWebTarget } from "./services/target-preparer.js";
import { fillDocxQuestionnaire } from "./services/docx-questionnaire.js";

function maskKey(key: string): string {
  if (key.length <= 8) return key ? "*".repeat(key.length) : "";
  return key.slice(0, 7) + "..." + key.slice(-4);
}

async function appSettingsPayload() {
  const key = readApiKey();
  const openAiKey = readOpenAiApiKey();
  return {
    anthropic_api_key_set: Boolean(key),
    anthropic_api_key_preview: maskKey(key),
    openai_api_key_set: Boolean(openAiKey),
    openai_api_key_preview: maskKey(openAiKey),
    ...(await getMediaToolStatuses()),
  };
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
  // ── Upload source document ───────────────────────────────────────────
  ipcMain.handle(
    ch.UPLOAD,
    async (_event, args: { buffer: ArrayBuffer; filename: string; workflow_id: string }) => {
      const buf = Buffer.from(args.buffer);
      if (!args.filename.toLowerCase().endsWith(".docx")) {
        throw new Error("Only .docx files are supported");
      }
      const parsed = await parseDocx(buf, args.filename);
      const wf = getWorkflow(args.workflow_id);
      wf.source_document = parsed;
      wf.source_document_bytes = buf;
      wf.source_document_filename = args.filename;
      return {
        filename: parsed.filename,
        chunk_count: parsed.chunks.length,
        preview: parsed.full_text.slice(0, 500),
      };
    },
  );

  // ── Get source document bytes ────────────────────────────────────────
  ipcMain.handle(ch.GET_DOCUMENT, async (_event, args: { workflow_id: string }) => {
    const wf = getWorkflow(args.workflow_id);
    if (!wf.source_document_bytes) {
      throw new Error("No document uploaded");
    }
    return {
      buffer: wf.source_document_bytes.buffer.slice(
        wf.source_document_bytes.byteOffset,
        wf.source_document_bytes.byteOffset + wf.source_document_bytes.byteLength,
      ),
      filename: wf.source_document?.filename ?? "document.docx",
    };
  });

  // ── Prepare target schema ────────────────────────────────────────────
  ipcMain.handle(
    ch.PREPARE_TARGET,
    async (
      _event,
      args:
        | { workflow_id: string; url: string }
        | { workflow_id: string; buffer: ArrayBuffer; filename: string },
    ) => {
      const wf = getWorkflow(args.workflow_id);
      let schema;
      if ("url" in args) {
        const normalizedUrl = normalizeAndValidateFormUrl(args.url);
        schema = await prepareWebTarget(normalizedUrl);
        wf.target_document_bytes = null;
        wf.target_document_filename = null;
      } else {
        const buf = Buffer.from(args.buffer);
        schema = await prepareFileTarget(buf, args.filename);
        wf.target_document_bytes = buf;
        wf.target_document_filename = args.filename;
      }
      wf.target_schema = schema;
      return schema;
    },
  );

  // ── Get target document bytes ────────────────────────────────────────
  ipcMain.handle(ch.GET_TARGET_DOCUMENT, async (_event, args: { workflow_id: string }) => {
    const wf = getWorkflow(args.workflow_id);
    if (!wf.target_document_bytes || !wf.target_document_filename) {
      throw new Error("No target document loaded");
    }
    return {
      buffer: wf.target_document_bytes.buffer.slice(
        wf.target_document_bytes.byteOffset,
        wf.target_document_bytes.byteOffset + wf.target_document_bytes.byteLength,
      ),
      filename: wf.target_document_filename,
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
    return appSettingsPayload();
  });

  ipcMain.handle(
    ch.PUT_SETTINGS,
    async (_event, args: { anthropic_api_key?: string; openai_api_key?: string }) => {
      if (typeof args.anthropic_api_key === "string") {
        const key = args.anthropic_api_key.trim();
        writeApiKey(key);
        settings.anthropic_api_key = key;
      }
      if (typeof args.openai_api_key === "string") {
        const key = args.openai_api_key.trim();
        writeOpenAiApiKey(key);
        settings.openai_api_key = key;
      }
      return appSettingsPayload();
    },
  );

  ipcMain.handle(ch.CLEAR_LOCAL_DATA, async () => {
    clearSettings();
    clearKnowledgeProfile();
    clearClients();
    clearSessions();
    clearHearings();
    resetAllWorkflows();
    settings.anthropic_api_key = "";
    settings.openai_api_key = "";
    return { ok: true };
  });

  // ── Legacy web form scrape alias ─────────────────────────────────────
  ipcMain.handle(ch.SCRAPE, async (_event, args: { url: string; workflow_id: string }) => {
    const normalizedUrl = normalizeAndValidateFormUrl(args.url);
    const schema = await prepareWebTarget(normalizedUrl);
    const wf = getWorkflow(args.workflow_id);
    wf.target_schema = schema;
    return schema;
  });

  // ── Map fields ───────────────────────────────────────────────────────
  ipcMain.handle(
    ch.MAP,
    async (_event, args: { workflow_id: string; client_id?: string; include_document?: boolean }) => {
      const wf = getWorkflow(args.workflow_id);
      const includeDocument = args.include_document ?? true;
      if (!wf.target_schema) {
        throw new Error("No target prepared. Prepare a web form or questionnaire first.");
      }

      const profile = loadKnowledgeProfile();
      const knowledgeProfile = knowledgeProfileHasContent(profile)
        ? profile
        : undefined;

      let clientKnowledge: string | undefined;
      if (args.client_id) {
        const client = getClient(args.client_id);
        if (client && client.knowledge.trim()) {
          clientKnowledge = client.knowledge;
        }
      }

      const hasDocument = includeDocument && Boolean(wf.source_document);
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
        hasDocument ? wf.source_document : null,
        wf.target_schema,
        knowledgeProfile,
        clientKnowledge,
      );
      wf.mapping_result = result;
      return result;
    },
  );

  // ── Hydrate transient state (for re-mapping historical sessions) ────
  ipcMain.handle(
    ch.HYDRATE_STATE,
    async (
      _event,
      args: {
        workflow_id: string;
        target_schema: Record<string, unknown>;
        source_document_bytes?: ArrayBuffer | null;
        source_document_filename?: string | null;
        target_document_bytes?: ArrayBuffer | null;
        target_document_filename?: string | null;
      },
    ) => {
      const wf = getWorkflow(args.workflow_id);
      const { TargetSchemaSchema } = await import("./services/models.js");
      wf.target_schema = TargetSchemaSchema.parse(args.target_schema);
      if (args.source_document_bytes) {
        const buf = Buffer.from(args.source_document_bytes);
        wf.source_document_bytes = buf;
        wf.source_document_filename = args.source_document_filename ?? "document.docx";
        wf.source_document = await parseDocx(
          buf,
          args.source_document_filename ?? "document.docx",
        );
      } else {
        wf.source_document = null;
        wf.source_document_bytes = null;
        wf.source_document_filename = null;
      }
      if (args.target_document_bytes) {
        const buf = Buffer.from(args.target_document_bytes);
        wf.target_document_bytes = buf;
        wf.target_document_filename =
          args.target_document_filename ?? wf.target_schema.target_filename ?? null;
      } else {
        wf.target_document_bytes = null;
        wf.target_document_filename = null;
      }
      return { ok: true };
    },
  );

  // ── Saved forms ──────────────────────────────────────────────────────
  ipcMain.handle(ch.LIST_SAVED_FORMS, async () => {
    return listSavedForms();
  });

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
    ch.GET_SESSION_TARGET_DOCUMENT,
    async (_event, args: { id: string }) => {
      const result = getSessionTargetDocument(args.id);
      if (!result) throw new Error("No target document for this session");
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
    ch.DOWNLOAD_FILLED_TARGET,
    async (
      _event,
      args: { workflow_id: string; mappings: Record<string, unknown>[] },
    ) => {
      const wf = getWorkflow(args.workflow_id);
      if (!wf.target_schema) {
        throw new Error("No target loaded.");
      }
      if (wf.target_schema.target_kind !== "docx_questionnaire") {
        throw new Error("Filled target export is only available for DOCX questionnaires.");
      }
      if (!wf.target_document_bytes || !wf.target_document_filename) {
        throw new Error("No DOCX target document is loaded.");
      }

      const filled = await fillDocxQuestionnaire(
        wf.target_document_bytes,
        wf.target_schema,
        args.mappings as never,
      );
      const filename = wf.target_document_filename.replace(/\.docx$/i, ".filled.docx");
      return {
        buffer: filled.buffer.slice(
          filled.byteOffset,
          filled.byteOffset + filled.byteLength,
        ),
        filename,
      };
    },
  );

  ipcMain.handle(
    ch.CREATE_SESSION,
    async (
      _event,
      args: {
        workflow_id: string;
        source_document_filename: string | null;
        target_kind: string;
        target_url: string;
        target_filename: string | null;
        target_title: string;
        target_provider: string;
        display_name?: string;
        target_schema: Record<string, unknown>;
        mapping_result: Record<string, unknown>;
      },
    ) => {
      const wf = getWorkflow(args.workflow_id);
      const includeSourceDocument = Boolean(args.source_document_filename);
      if (includeSourceDocument && !wf.source_document_bytes) {
        throw new Error("Source document metadata was provided, but no source document is loaded.");
      }
      const includeTargetDocument = Boolean(args.target_filename);
      if (includeTargetDocument && !wf.target_document_bytes) {
        throw new Error("Target document metadata was provided, but no target document is loaded.");
      }

      // Generate an AI session name via Haiku when no explicit name was given
      let displayName = args.display_name;
      if (!displayName) {
        const fields = (args.target_schema as { fields?: { label?: string }[] })
          .fields;
        const fieldLabels = fields
          ? fields.map((f) => f.label ?? "").filter(Boolean)
          : [];
        displayName = await generateSessionName({
          sourceDocumentFilename: args.source_document_filename,
          targetFilename: args.target_filename,
          targetTitle: args.target_title,
          targetFieldLabels: fieldLabels,
        });
      }

      const session = createSession({
        sourceDocumentFilename: args.source_document_filename,
        sourceDocumentBytes: includeSourceDocument ? wf.source_document_bytes : null,
        targetKind: args.target_kind as never,
        targetUrl: args.target_url,
        targetFilename: args.target_filename,
        targetDocumentBytes: includeTargetDocument ? wf.target_document_bytes : null,
        targetTitle: args.target_title,
        targetProvider: args.target_provider,
        displayName,
        targetSchema: args.target_schema,
        mappingResult: args.mapping_result,
      });

      return session;
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

  // ── Workflow cleanup ──────────────────────────────────────────────────
  ipcMain.handle(
    ch.DELETE_WORKFLOW,
    async (_event, args: { workflow_id: string }) => {
      deleteWorkflow(args.workflow_id);
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

  // ── Hearing Intelligence ───────────────────────────────────────────
  ipcMain.handle(ch.LIST_HEARING_JOBS, async () => {
    return listHearingIntelligenceJobs();
  });

  ipcMain.handle(ch.GET_HEARING_WORKSPACE, async (_event, args: { id: string }) => {
    return getHearingIntelligenceWorkspace(args.id);
  });

  ipcMain.handle(ch.CREATE_HEARING_JOB, async (_event, args) => {
    return createHearingIntelligenceJob({
      client_id: String(args.client_id ?? ""),
      client_name:
        typeof args.client_name === "string" ? args.client_name : undefined,
      matter_id: typeof args.matter_id === "string" ? args.matter_id : null,
      source_url: String(args.source_url ?? ""),
      mode: args.mode,
      client_context:
        typeof args.client_context === "object" && args.client_context !== null
          ? args.client_context
          : {},
      watch_items: Array.isArray(args.watch_items) ? args.watch_items : [],
    });
  });

  ipcMain.handle(ch.RESOLVE_HEARING_JOB, async (_event, args: { id: string }) => {
    return resolveHearingIntelligenceJob(args.id);
  });

  ipcMain.handle(ch.RESOLVE_HEARING_STREAM, async (_event, args: { id: string }) => {
    return resolveHearingIntelligenceStream(args.id);
  });

  ipcMain.handle(ch.START_HEARING_CAPTURE, async (_event, args) => {
    return startHearingIntelligenceCapture({
      hearingJobId: String(args.hearing_job_id ?? args.id ?? ""),
      streamUrl:
        typeof args.stream_url === "string" && args.stream_url.trim()
          ? args.stream_url
          : undefined,
    });
  });

  ipcMain.handle(ch.STOP_HEARING_CAPTURE, async (_event, args) => {
    return stopHearingIntelligenceCapture(String(args.hearing_job_id ?? args.id ?? ""));
  });

  ipcMain.handle(ch.GET_HEARING_CAPTURE_STATUS, async (_event, args) => {
    return getHearingIntelligenceCaptureStatus(String(args.hearing_job_id ?? args.id ?? ""));
  });

  ipcMain.handle(ch.GENERATE_FINAL_HEARING_BRIEF, async (_event, args) => {
    return generateFinalHearingIntelligenceBrief({
      hearingJobId: String(args.hearing_job_id ?? args.id ?? ""),
      outputType: args.output_type,
      reviewerInstructions:
        typeof args.reviewer_instructions === "string"
          ? args.reviewer_instructions
          : undefined,
      useAi: typeof args.use_ai === "boolean" ? args.use_ai : undefined,
    });
  });

  ipcMain.handle(ch.IMPORT_HEARING_TRANSCRIPT, async (_event, args) => {
    if (typeof args.media_url === "string" && args.media_url.trim()) {
      return transcribeAndImportHearingMedia({
        hearingJobId: String(args.hearing_job_id ?? args.id ?? ""),
        mediaUrl: args.media_url,
      });
    }
    if (typeof args.transcript_url === "string" && args.transcript_url.trim()) {
      return fetchAndImportHearingTranscript({
        hearingJobId: String(args.hearing_job_id ?? args.id ?? ""),
        transcriptUrl: args.transcript_url,
      });
    }
    return importHearingTranscript({
      hearingJobId: String(args.hearing_job_id ?? args.id ?? ""),
      text: String(args.text ?? ""),
      filename: typeof args.filename === "string" ? args.filename : undefined,
      source: args.source,
    });
  });

  ipcMain.handle(
    ch.UPDATE_HEARING_WATCHLIST,
    async (_event, args: { id: string; watch_items: unknown[] }) => {
      return saveHearingWatchItems({
        hearingJobId: args.id,
        watchItems: args.watch_items as never,
      });
    },
  );

  ipcMain.handle(ch.RUN_HEARING_WATCHLIST, async (_event, args: { id: string }) => {
    return runHearingWatchlist(args.id);
  });

  ipcMain.handle(ch.GENERATE_HEARING_OUTPUT, async (_event, args) => {
    return generateHearingIntelligenceOutput({
      hearingJobId: String(args.hearing_job_id ?? args.id ?? ""),
      outputType: args.output_type,
      reviewerInstructions:
        typeof args.reviewer_instructions === "string"
          ? args.reviewer_instructions
          : undefined,
      useAi: typeof args.use_ai === "boolean" ? args.use_ai : undefined,
    });
  });

  ipcMain.handle(ch.RUN_HEARING_JOB, async (_event, args) => {
    return runHearingIntelligenceJob({
      hearingJobId: String(args.hearing_job_id ?? args.id ?? ""),
      outputType: args.output_type,
      reviewerInstructions:
        typeof args.reviewer_instructions === "string"
          ? args.reviewer_instructions
          : undefined,
      useAi: typeof args.use_ai === "boolean" ? args.use_ai : undefined,
    });
  });

  ipcMain.handle(ch.UPDATE_HEARING_REVIEW, async (_event, args) => {
    return updateHearingReview({
      segmentId: typeof args.segment_id === "string" ? args.segment_id : undefined,
      segmentReviewStatus: args.segment_review_status,
      speakerLabel:
        typeof args.speaker_label === "string" ? args.speaker_label : undefined,
      hitId: typeof args.hit_id === "string" ? args.hit_id : undefined,
      hitStatus: args.hit_status,
      outputId: typeof args.output_id === "string" ? args.output_id : undefined,
      outputMarkdown:
        typeof args.output_markdown === "string"
          ? args.output_markdown
          : undefined,
      outputReviewStatus: args.output_review_status,
      claimId: typeof args.claim_id === "string" ? args.claim_id : undefined,
      claimVerificationStatus: args.claim_verification_status,
    });
  });

  ipcMain.handle(ch.ADD_HEARING_COMMENT, async (_event, args) => {
    return addHearingReviewComment({
      hearingJobId: String(args.hearing_job_id ?? args.id ?? ""),
      targetType: args.target_type,
      targetId: String(args.target_id ?? ""),
      comment: String(args.comment ?? ""),
    });
  });

  ipcMain.handle(ch.EXPORT_HEARING_RESULTS, async (_event, args) => {
    const result = await exportHearingIntelligence({
      hearingJobId: String(args.hearing_job_id ?? args.id ?? ""),
      format: args.format,
      outputId: typeof args.output_id === "string" ? args.output_id : undefined,
    });
    const bytes = Buffer.from(result.buffer);
    return {
      buffer: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ),
      filename: result.filename,
      mime_type: result.mime_type,
    };
  });

  // ── App updates ──────────────────────────────────────────────────────
  ipcMain.handle(ch.GET_APP_VERSION, () => {
    return { version: app.getVersion() };
  });

  ipcMain.handle(ch.CHECK_FOR_UPDATE, () => {
    if (!app.isPackaged || process.platform !== "darwin") {
      // In dev / unpackaged builds autoUpdater has no feed URL and will throw.
      // Broadcast a not-available status so the UI stays consistent.
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(UPDATE_STATUS, { status: "not-available" });
        }
      }
      return;
    }
    try {
      autoUpdater.checkForUpdates();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(UPDATE_STATUS, { status: "error", error: message });
        }
      }
    }
  });

  ipcMain.handle(ch.INSTALL_UPDATE, () => {
    autoUpdater.quitAndInstall();
  });
}
