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
  document_filename: string | null;
  form_url: string;
  form_title: string;
  form_provider: string;
  form_schema: FormSchema;
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

export type ProcessingStage = "uploading" | "scraping" | "mapping" | null;

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
  const [processingFormUrl, setProcessingFormUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const [formSchema, setFormSchema] = useState<FormSchema | null>(null);
  const [mappingResult, setMappingResult] = useState<MappingResult | null>(null);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [debugDocBlobUrl, setDebugDocBlobUrl] = useState<string | null>(null);
  const documentBlobUrlRef = useRef<string | null>(null);
  const [isHistorical, setIsHistorical] = useState(false);
  const [hasDocument, setHasDocument] = useState(false);
  const [activeClientId, setActiveClientId] = useState<string | undefined>(
    undefined,
  );
  const [includeDocument, setIncludeDocument] = useState(false);

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
    async (file: File | null, formUrl: string, clientId?: string) => {
      if (!apiKeyConfigured) {
        setError(MISSING_API_KEY_MESSAGE);
        return;
      }

      const shouldIncludeDocument = Boolean(file);
      setLoading(true);
      setProcessingStage(shouldIncludeDocument ? "uploading" : "scraping");
      setProcessingFormUrl(formUrl);
      setError(null);
      replaceDocumentBlobUrl(null);
      setIsHistorical(false);
      setHasDocument(shouldIncludeDocument);
      setIncludeDocument(shouldIncludeDocument);
      setActiveClientId(clientId);

      try {
        // Run upload and scrape in parallel when both are needed
        const [uploaded, schema] = await Promise.all([
          file ? api.uploadDocument(file, workflowId) : Promise.resolve(null),
          api.scrapeForm(formUrl, workflowId),
        ]);

        setUploadResult(uploaded);
        if (schema.fields.length === 0) {
          throw new Error(
            "No form fields detected. The form may require login, be expired, or have an unsupported structure.",
          );
        }
        setFormSchema(schema);

        setProcessingStage("mapping");
        const result = await api.mapFields({
          workflowId,
          clientId,
          includeDocument: shouldIncludeDocument,
        });
        setMappingResult(result);
        setMappings(result.mappings);
        setStep("answers");

        // Wait for session persistence before clearing the processing indicator
        try {
          await onMappingCompleteRef.current?.({
            workflow_id: workflowId,
            document_filename: uploaded?.filename ?? null,
            form_url: schema.url || formUrl,
            form_title: schema.title,
            form_provider: schema.provider,
            form_schema: schema,
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
        setProcessingFormUrl(null);
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
        includeDocument,
      });
      setMappingResult(result);
      setMappings(result.mappings);
    } catch (err: unknown) {
      setError(errorMessage(err, "Re-mapping failed"));
    } finally {
      setLoading(false);
      setProcessingStage(null);
    }
  }, [apiKeyConfigured, activeClientId, includeDocument, workflowId]);

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
    setProcessingFormUrl(null);
    setError(null);
    setUploadResult(null);
    setFormSchema(null);
    setMappingResult(null);
    setMappings([]);
    replaceDocumentBlobUrl(null);
    setIsHistorical(false);
    setHasDocument(false);
    setActiveClientId(undefined);
    setIncludeDocument(false);
  }, [replaceDocumentBlobUrl]);

  const hydrateSession = useCallback(
    async (session: SessionFull) => {
      const sessionHasDocument = Boolean(session.document_filename);
      setError(null);
      setFormSchema(session.form_schema);
      setMappingResult(session.mapping_result);
      setMappings(session.edited_mappings ?? session.mapping_result.mappings);

      let docBytes: ArrayBuffer | null = null;
      if (sessionHasDocument) {
        try {
          const blobUrl = await api.getSessionDocumentBlobUrl(session.id);
          replaceDocumentBlobUrl(blobUrl);
          const docResult = await api.getSessionDocumentBytes(session.id);
          docBytes = docResult;
        } catch (err: unknown) {
          setError(errorMessage(err, "Could not load historical session document"));
          replaceDocumentBlobUrl(null);
        }
      } else {
        replaceDocumentBlobUrl(null);
      }

      try {
        await api.hydrateState({
          workflowId,
          formSchema: session.form_schema,
          documentBytes: docBytes,
          documentFilename: session.document_filename,
        });
      } catch {
        // Non-fatal: re-map may still work if only knowledge context is needed
      }

      setHasDocument(sessionHasDocument);
      setIncludeDocument(sessionHasDocument);
      setActiveClientId(undefined);
      setIsHistorical(true);
      setStep("answers");
    },
    [replaceDocumentBlobUrl, workflowId],
  );

  const loadDebugData = useCallback(() => {
    setError(null);
    setUploadResult(DEBUG_UPLOAD_RESPONSE);
    setFormSchema(DEBUG_FORM_SCHEMA);
    setMappingResult(DEBUG_MAPPING_RESULT);
    setMappings(DEBUG_MAPPING_RESULT.mappings);
    replaceDocumentBlobUrl(DEBUG_DOC_BLOB_URL);
    setHasDocument(true);
    setIncludeDocument(true);
    setActiveClientId(undefined);
    setIsHistorical(false);
    setStep("answers");
  }, [replaceDocumentBlobUrl]);

  return {
    step,
    loading,
    processingStage,
    processingFormUrl,
    error,
    apiKeyConfigured,
    uploadResult,
    formSchema,
    mappingResult,
    mappings,
    debugDocBlobUrl,
    isHistorical,
    hasDocument,
    process,
    remap,
    updateMapping,
    reset,
    hydrateSession,
    loadDebugData,
  };
}
