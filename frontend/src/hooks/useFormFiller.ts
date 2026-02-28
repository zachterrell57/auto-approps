import { useState, useCallback, useEffect } from "react";
import * as api from "@/lib/api";
import type {
  FieldMapping,
  FormSchema,
  KnowledgeProfile,
  MappingResult,
  UploadResponse,
} from "@/lib/types";

export type Step = "upload" | "answers";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function hasProfileContent(profile: Pick<KnowledgeProfile, "user_context" | "firm_context">): boolean {
  return Boolean(profile.user_context.trim() || profile.firm_context.trim());
}

export function useFormFiller() {
  const [step, setStep] = useState<Step>("upload");
  const [loading, setLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const [formSchema, setFormSchema] = useState<FormSchema | null>(null);
  const [mappingResult, setMappingResult] = useState<MappingResult | null>(null);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [knowledgeProfile, setKnowledgeProfile] = useState<KnowledgeProfile>({
    user_context: "",
    firm_context: "",
    updated_at: null,
  });
  const [profileDirty, setProfileDirty] = useState(false);
  const [useProfileContext, setUseProfileContext] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadKnowledgeProfile() {
      try {
        const loaded = await api.getKnowledgeProfile();
        if (cancelled) return;
        setKnowledgeProfile(loaded);
        setProfileDirty(false);
        setUseProfileContext(hasProfileContent(loaded));
      } catch (error: unknown) {
        if (cancelled) return;
        setError(errorMessage(error, "Failed to load knowledge profile"));
      }
    }

    loadKnowledgeProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  const process = useCallback(async (file: File, formUrl: string) => {
    setLoading(true);
    setError(null);
    try {
      const uploaded = await api.uploadDocument(file);
      setUploadResult(uploaded);

      const schema = await api.scrapeForm(formUrl);
      setFormSchema(schema);

      const result = await api.mapFields({ use_profile_context: useProfileContext });
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
  }, [useProfileContext]);

  const remap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.mapFields({ use_profile_context: useProfileContext });
      setMappingResult(result);
      setMappings(
        result.mappings.map((m) => ({ ...m, skip: false }))
      );
    } catch (error: unknown) {
      setError(errorMessage(error, "Re-mapping failed"));
    } finally {
      setLoading(false);
    }
  }, [useProfileContext]);

  const updateKnowledgeProfile = useCallback(
    (updates: Partial<Pick<KnowledgeProfile, "user_context" | "firm_context">>) => {
      setKnowledgeProfile((prev) => ({ ...prev, ...updates }));
      setProfileDirty(true);
    },
    []
  );

  const saveKnowledgeProfile = useCallback(async () => {
    setProfileSaving(true);
    setError(null);
    try {
      const saved = await api.saveKnowledgeProfile({
        user_context: knowledgeProfile.user_context,
        firm_context: knowledgeProfile.firm_context,
      });
      setKnowledgeProfile(saved);
      setProfileDirty(false);
      setUseProfileContext(hasProfileContent(saved));
    } catch (error: unknown) {
      setError(errorMessage(error, "Failed to save knowledge profile"));
    } finally {
      setProfileSaving(false);
    }
  }, [knowledgeProfile.firm_context, knowledgeProfile.user_context]);

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
    profileSaving,
    error,
    uploadResult,
    formSchema,
    mappingResult,
    mappings,
    knowledgeProfile,
    profileDirty,
    useProfileContext,
    process,
    remap,
    updateMapping,
    updateKnowledgeProfile,
    saveKnowledgeProfile,
    setUseProfileContext,
    reset,
  };
}
