import { useState, useCallback } from "react";
import * as api from "@/lib/api";
import type {
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
  const [error, setError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const [formSchema, setFormSchema] = useState<FormSchema | null>(null);
  const [mappingResult, setMappingResult] = useState<MappingResult | null>(null);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);

  const process = useCallback(async (file: File, formUrl: string) => {
    setLoading(true);
    setError(null);
    try {
      const uploaded = await api.uploadDocument(file);
      setUploadResult(uploaded);

      const schema = await api.scrapeForm(formUrl);
      setFormSchema(schema);

      const result = await api.mapFields();
      setMappingResult(result);
      setMappings(
        result.mappings.map((m) => ({ ...m, skip: false }))
      );
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
      setMappings(
        result.mappings.map((m) => ({ ...m, skip: false }))
      );
    } catch (error: unknown) {
      setError(errorMessage(error, "Re-mapping failed"));
    } finally {
      setLoading(false);
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
  }, []);

  return {
    step,
    loading,
    error,
    uploadResult,
    formSchema,
    mappingResult,
    mappings,
    process,
    remap,
    updateMapping,
    reset,
  };
}
