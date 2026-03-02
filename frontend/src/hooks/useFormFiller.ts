import { useState, useCallback, useEffect, useRef } from "react";
import * as api from "@/lib/api";
import {
  DEBUG_DOC_BLOB_URL,
  DEBUG_FORM_SCHEMA,
  DEBUG_MAPPING_RESULT,
  DEBUG_UPLOAD_RESPONSE,
} from "@/lib/debug-fixtures";
import type {
  AppSettings,
  FieldMapping,
  FormSchema,
  MappingResult,
  SessionFull,
  UploadResponse,
} from "@/lib/types";

export type Step = "upload" | "answers";

export interface MappingCompleteData {
  document_filename: string;
  form_url: string;
  form_title: string;
  form_provider: string;
  form_schema: FormSchema;
  mapping_result: MappingResult;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export type ProcessingStage = "uploading" | "scraping" | "mapping" | null;

export function useFormFiller(options?: {
  onMappingComplete?: (data: MappingCompleteData) => void;
}) {
  const onMappingCompleteRef = useRef(options?.onMappingComplete);
  onMappingCompleteRef.current = options?.onMappingComplete;

  const [step, setStep] = useState<Step>("upload");
  const [loading, setLoading] = useState(false);
  const [processingStage, setProcessingStage] = useState<ProcessingStage>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>({
    anthropic_api_key_set: false,
    anthropic_api_key_preview: "",
  });
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const [formSchema, setFormSchema] = useState<FormSchema | null>(null);
  const [mappingResult, setMappingResult] = useState<MappingResult | null>(null);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [debugDocBlobUrl, setDebugDocBlobUrl] = useState<string | null>(null);
  const [isHistorical, setIsHistorical] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadSettings() {
      try {
        const loaded = await api.getSettings();
        if (cancelled) return;
        setAppSettings(loaded);
      } catch (error: unknown) {
        if (cancelled) return;
        setError(errorMessage(error, "Failed to load settings"));
      }
    }
    loadSettings();
    return () => { cancelled = true; };
  }, []);

  const process = useCallback(async (file: File, formUrl: string, clientId?: string) => {
    setLoading(true);
    setError(null);
    setDebugDocBlobUrl(null);
    setIsHistorical(false);
    try {
      setProcessingStage("uploading");
      const uploaded = await api.uploadDocument(file);
      setUploadResult(uploaded);

      setProcessingStage("scraping");
      const schema = await api.scrapeForm(formUrl);
      setFormSchema(schema);

      setProcessingStage("mapping");
      const result = await api.mapFields(clientId);
      setMappingResult(result);
      setMappings(result.mappings);
      setStep("answers");

      onMappingCompleteRef.current?.({
        document_filename: uploaded.filename,
        form_url: schema.url || formUrl,
        form_title: schema.title,
        form_provider: schema.provider,
        form_schema: schema,
        mapping_result: result,
      });
    } catch (error: unknown) {
      setError(errorMessage(error, "An error occurred"));
    } finally {
      setLoading(false);
      setProcessingStage(null);
    }
  }, []);

  const remap = useCallback(async (clientId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.mapFields(clientId);
      setMappingResult(result);
      setMappings(result.mappings);
    } catch (error: unknown) {
      setError(errorMessage(error, "Re-mapping failed"));
    } finally {
      setLoading(false);
    }
  }, []);

  const saveAppSettings = useCallback(async (apiKey: string) => {
    setSettingsSaving(true);
    setError(null);
    try {
      const saved = await api.saveSettings({ anthropic_api_key: apiKey });
      setAppSettings(saved);
    } catch (error: unknown) {
      setError(errorMessage(error, "Failed to save settings"));
    } finally {
      setSettingsSaving(false);
    }
  }, []);

  const updateMapping = useCallback(
    (index: number, updates: Partial<FieldMapping>) => {
      setMappings((prev) =>
        prev.map((m, i) => (i === index ? { ...m, ...updates } : m))
      );
    },
    []
  );

  const reset = useCallback(() => {
    setStep("upload");
    setLoading(false);
    setProcessingStage(null);
    setError(null);
    setUploadResult(null);
    setFormSchema(null);
    setMappingResult(null);
    setMappings([]);
    setDebugDocBlobUrl(null);
    setIsHistorical(false);
  }, []);

  const hydrateSession = useCallback((session: SessionFull) => {
    setError(null);
    setFormSchema(session.form_schema);
    setMappingResult(session.mapping_result);
    setMappings(
      session.edited_mappings ?? session.mapping_result.mappings
    );
    setDebugDocBlobUrl(`/api/sessions/${session.id}/document`);
    setIsHistorical(true);
    setStep("answers");
  }, []);

  const loadDebugData = useCallback(() => {
    setError(null);
    setUploadResult(DEBUG_UPLOAD_RESPONSE);
    setFormSchema(DEBUG_FORM_SCHEMA);
    setMappingResult(DEBUG_MAPPING_RESULT);
    setMappings(DEBUG_MAPPING_RESULT.mappings);
    setDebugDocBlobUrl(DEBUG_DOC_BLOB_URL);
    setIsHistorical(false);
    setStep("answers");
  }, []);

  return {
    step,
    loading,
    processingStage,
    settingsSaving,
    error,
    uploadResult,
    formSchema,
    mappingResult,
    mappings,
    appSettings,
    debugDocBlobUrl,
    isHistorical,
    process,
    remap,
    updateMapping,
    saveAppSettings,
    reset,
    hydrateSession,
    loadDebugData,
  };
}
