import { useState, useCallback, useEffect, useRef } from "react";
import * as api from "@/lib/api";
import {
  DEBUG_DOC_BLOB_URL,
  DEBUG_FORM_SCHEMA,
  DEBUG_MAPPING_RESULT,
  DEBUG_UPLOAD_RESPONSE,
} from "@/lib/debug-fixtures";
import type {
  FieldMapping,
  FormSchema,
  MappingResult,
  SessionFull,
  UploadResponse,
} from "@/lib/types";

export type Step = "upload" | "answers";

export interface MappingCompleteData {
  workflow_id: string;
  source_document_filename: string | null;
  target_kind: FormSchema["target_kind"];
  target_url: string;
  target_filename: string | null;
  target_title: string;
  target_provider: string;
  target_schema: FormSchema;
  mapping_result: MappingResult;
}

const MISSING_API_KEY_MESSAGE =
  "Add your Anthropic API key in Settings before processing forms.";

function isMissingApiKeyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("anthropic_api_key") ||
    message.includes("anthropic api key") ||
    message.includes("missing_api_key")
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (isMissingApiKeyError(error)) return MISSING_API_KEY_MESSAGE;
  return error instanceof Error ? error.message : fallback;
}

function isDiagnosedFormState(schema: FormSchema): boolean {
  const state = (schema.form_state || "open").trim().toLowerCase();
  return state.length > 0 && state !== "open" && state !== "unknown";
}

export type ProcessingStage =
  | "reading_source"
  | "preparing_target"
  | "mapping"
  | "generating_document"
  | null;
export type TargetInputMode = "web_form" | "questionnaire";

export interface ProcessRequest {
  inputMode: TargetInputMode;
  sourceFile: File | null;
  targetUrl: string;
  targetFile: File | null;
  clientId?: string;
}

export function useFormFiller(options: {
  workflowId: string;
  apiKeyConfigured: boolean;
  onMappingComplete?: (data: MappingCompleteData) => void;
}) {
  const { workflowId, apiKeyConfigured } = options;
  const onMappingCompleteRef = useRef(options.onMappingComplete);
  onMappingCompleteRef.current = options.onMappingComplete;

  const [step, setStep] = useState<Step>("upload");
  const [loading, setLoading] = useState(false);
  const [processingStage, setProcessingStage] = useState<ProcessingStage>(null);
  const [processingTargetLabel, setProcessingTargetLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceUploadResult, setSourceUploadResult] = useState<UploadResponse | null>(null);
  const [targetSchema, setTargetSchema] = useState<FormSchema | null>(null);
  const [mappingResult, setMappingResult] = useState<MappingResult | null>(null);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [debugDocBlobUrl, setDebugDocBlobUrl] = useState<string | null>(null);
  const documentBlobUrlRef = useRef<string | null>(null);
  const [isHistorical, setIsHistorical] = useState(false);
  const [hasSourceDocument, setHasSourceDocument] = useState(false);
  const [activeClientId, setActiveClientId] = useState<string | undefined>(
    undefined,
  );
  const [includeSourceDocument, setIncludeSourceDocument] = useState(false);

  const replaceDocumentBlobUrl = useCallback((nextUrl: string | null) => {
    if (documentBlobUrlRef.current?.startsWith("blob:")) {
      URL.revokeObjectURL(documentBlobUrlRef.current);
    }
    documentBlobUrlRef.current = nextUrl;
    setDebugDocBlobUrl(nextUrl);
  }, []);

  useEffect(() => {
    return () => {
      if (documentBlobUrlRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(documentBlobUrlRef.current);
      }
    };
  }, []);

  const process = useCallback(
    async ({
      inputMode,
      sourceFile,
      targetUrl,
      targetFile,
      clientId,
    }: ProcessRequest) => {
      if (!apiKeyConfigured) {
        setError(MISSING_API_KEY_MESSAGE);
        return;
      }

      const shouldIncludeSourceDocument = Boolean(sourceFile);
      const isQuestionnaireTarget = inputMode === "questionnaire";
      if (isQuestionnaireTarget && !targetFile) {
        setError("Choose a document to continue.");
        return;
      }

      setLoading(true);
      setProcessingStage(
        shouldIncludeSourceDocument ? "reading_source" : "preparing_target",
      );
      setProcessingTargetLabel(
        isQuestionnaireTarget ? targetFile?.name ?? null : targetUrl,
      );
      setError(null);
      setSourceUploadResult(null);
      setTargetSchema(null);
      setMappingResult(null);
      setMappings([]);
      replaceDocumentBlobUrl(null);
      setIsHistorical(false);
      setHasSourceDocument(shouldIncludeSourceDocument);
      setIncludeSourceDocument(shouldIncludeSourceDocument);
      setActiveClientId(clientId);

      try {
        const [uploaded, schema] = await Promise.all([
          sourceFile
            ? api.uploadDocument(sourceFile, workflowId)
            : Promise.resolve(null),
          isQuestionnaireTarget && targetFile
            ? api.prepareTargetFromFile(targetFile, workflowId)
            : api.prepareTargetFromUrl(targetUrl, workflowId),
        ]);

        setSourceUploadResult(uploaded);
        setTargetSchema(schema);
        if (isDiagnosedFormState(schema)) {
          return;
        }
        if (schema.fields.length === 0) {
          throw new Error(
            "No target fields detected. The questionnaire may be unsupported or the web form may require login.",
          );
        }

        setProcessingStage("mapping");
        const result = await api.mapFields({
          workflowId,
          clientId,
          includeDocument: shouldIncludeSourceDocument,
        });
        setMappingResult(result);
        setMappings(result.mappings);
        setStep("answers");

        // Wait for session persistence before clearing the processing indicator
        try {
          await onMappingCompleteRef.current?.({
            workflow_id: workflowId,
            source_document_filename: uploaded?.filename ?? null,
            target_kind: schema.target_kind,
            target_url: schema.target_url || targetUrl,
            target_filename: schema.target_filename ?? targetFile?.name ?? null,
            target_title: schema.target_title || schema.title,
            target_provider: schema.target_provider || schema.provider,
            target_schema: schema,
            mapping_result: result,
          });
        } catch {
          // Session save errors are handled by the caller
        }
      } catch (err: unknown) {
        setError(errorMessage(err, "An error occurred"));
      } finally {
        setLoading(false);
        setProcessingStage(null);
        setProcessingTargetLabel(null);
      }
    },
    [apiKeyConfigured, replaceDocumentBlobUrl, workflowId],
  );

  const remap = useCallback(async () => {
    if (!apiKeyConfigured) {
      setError(MISSING_API_KEY_MESSAGE);
      return;
    }

    setLoading(true);
    setProcessingStage("mapping");
    setError(null);
    try {
      const result = await api.mapFields({
        workflowId,
        clientId: activeClientId,
        includeDocument: includeSourceDocument,
      });
      setMappingResult(result);
      setMappings(result.mappings);
    } catch (err: unknown) {
      setError(errorMessage(err, "Re-mapping failed"));
    } finally {
      setLoading(false);
      setProcessingStage(null);
    }
  }, [apiKeyConfigured, activeClientId, includeSourceDocument, workflowId]);

  const updateMapping = useCallback(
    (index: number, updates: Partial<FieldMapping>) => {
      setMappings((prev) =>
        prev.map((m, i) => (i === index ? { ...m, ...updates } : m)),
      );
    },
    [],
  );

  const reset = useCallback(() => {
    setStep("upload");
    setLoading(false);
    setProcessingStage(null);
    setProcessingTargetLabel(null);
    setError(null);
    setSourceUploadResult(null);
    setTargetSchema(null);
    setMappingResult(null);
    setMappings([]);
    replaceDocumentBlobUrl(null);
    setIsHistorical(false);
    setHasSourceDocument(false);
    setActiveClientId(undefined);
    setIncludeSourceDocument(false);
  }, [replaceDocumentBlobUrl]);

  const hydrateSession = useCallback(
    async (session: SessionFull) => {
      const sessionHasSourceDocument = Boolean(session.source_document_filename);
      setError(null);
      setTargetSchema(session.target_schema);
      setMappingResult(session.mapping_result);
      setMappings(session.edited_mappings ?? session.mapping_result.mappings);

      let sourceDocBytes: ArrayBuffer | null = null;
      if (sessionHasSourceDocument) {
        try {
          const blobUrl = await api.getSessionDocumentBlobUrl(session.id);
          replaceDocumentBlobUrl(blobUrl);
          sourceDocBytes = await api.getSessionDocumentBytes(session.id);
        } catch (err: unknown) {
          setError(errorMessage(err, "Could not load historical source document"));
          replaceDocumentBlobUrl(null);
        }
      } else {
        replaceDocumentBlobUrl(null);
      }

      let targetDocBytes: ArrayBuffer | null = null;
      if (session.target_filename) {
        try {
          targetDocBytes = await api.getSessionTargetDocumentBytes(session.id);
        } catch (err: unknown) {
          setError(errorMessage(err, "Could not load historical target document"));
        }
      }

      try {
        await api.hydrateState({
          workflowId,
          targetSchema: session.target_schema,
          sourceDocumentBytes: sourceDocBytes,
          sourceDocumentFilename: session.source_document_filename,
          targetDocumentBytes: targetDocBytes,
          targetDocumentFilename: session.target_filename,
        });
      } catch {
        // Non-fatal: re-map may still work if only knowledge context is needed
      }

      setHasSourceDocument(sessionHasSourceDocument);
      setIncludeSourceDocument(sessionHasSourceDocument);
      setActiveClientId(undefined);
      setIsHistorical(true);
      setStep("answers");
    },
    [replaceDocumentBlobUrl, workflowId],
  );

  const loadDebugData = useCallback(() => {
    setError(null);
    setSourceUploadResult(DEBUG_UPLOAD_RESPONSE);
    setTargetSchema(DEBUG_FORM_SCHEMA);
    setMappingResult(DEBUG_MAPPING_RESULT);
    setMappings(DEBUG_MAPPING_RESULT.mappings);
    replaceDocumentBlobUrl(DEBUG_DOC_BLOB_URL);
    setHasSourceDocument(true);
    setIncludeSourceDocument(true);
    setActiveClientId(undefined);
    setIsHistorical(false);
    setStep("answers");
  }, [replaceDocumentBlobUrl]);

  const downloadFilledTarget = useCallback(async () => {
    if (!targetSchema || targetSchema.target_kind !== "docx_questionnaire") {
      return;
    }

    setLoading(true);
    setProcessingStage("generating_document");
    setError(null);
    try {
      const result = await api.downloadFilledTarget(workflowId, mappings);
      const blob = new Blob([result.buffer], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err: unknown) {
      setError(errorMessage(err, "Could not generate the filled DOCX."));
    } finally {
      setLoading(false);
      setProcessingStage(null);
    }
  }, [mappings, targetSchema, workflowId]);

  return {
    step,
    loading,
    processingStage,
    processingTargetLabel,
    error,
    apiKeyConfigured,
    sourceUploadResult,
    targetSchema,
    mappingResult,
    mappings,
    debugDocBlobUrl,
    isHistorical,
    hasSourceDocument,
    process,
    remap,
    downloadFilledTarget,
    updateMapping,
    reset,
    hydrateSession,
    loadDebugData,
  };
}
