import { useState, useCallback, useEffect } from "react";
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
  UploadResponse,
} from "@/lib/types";

export type Step = "upload" | "answers";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useFormFiller() {
  const [step, setStep] = useState<Step>("upload");
  const [loading, setLoading] = useState(false);
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

  const process = useCallback(async (file: File, formUrl: string) => {
    setLoading(true);
    setError(null);
    setDebugDocBlobUrl(null);
    try {
      const uploaded = await api.uploadDocument(file);
      setUploadResult(uploaded);

      const schema = await api.scrapeForm(formUrl);
      setFormSchema(schema);

      const result = await api.mapFields();
      setMappingResult(result);
      setMappings(result.mappings);
      setStep("answers");
    } catch (error: unknown) {
      setError(errorMessage(error, "An error occurred"));
    } finally {
      setLoading(false);
    }
  }, []);

  const remap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.mapFields();
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
    setError(null);
    setUploadResult(null);
    setFormSchema(null);
    setMappingResult(null);
    setMappings([]);
    setDebugDocBlobUrl(null);
  }, []);

  const loadDebugData = useCallback(() => {
    setError(null);
    setUploadResult(DEBUG_UPLOAD_RESPONSE);
    setFormSchema(DEBUG_FORM_SCHEMA);
    setMappingResult(DEBUG_MAPPING_RESULT);
    setMappings(DEBUG_MAPPING_RESULT.mappings);
    setDebugDocBlobUrl(DEBUG_DOC_BLOB_URL);
    setStep("answers");
  }, []);

  return {
    step,
    loading,
    settingsSaving,
    error,
    uploadResult,
    formSchema,
    mappingResult,
    mappings,
    appSettings,
    debugDocBlobUrl,
    process,
    remap,
    updateMapping,
    saveAppSettings,
    reset,
    loadDebugData,
  };
}
