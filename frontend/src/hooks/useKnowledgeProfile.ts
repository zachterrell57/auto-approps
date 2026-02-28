import { useState, useCallback, useEffect } from "react";
import * as api from "@/lib/api";
import type { KnowledgeProfile } from "@/lib/types";

function hasContent(profile: Pick<KnowledgeProfile, "user_context" | "firm_context">): boolean {
  return Boolean(profile.user_context.trim() || profile.firm_context.trim());
}

interface UseKnowledgeProfileOptions {
  onLoaded?: (profile: KnowledgeProfile) => void;
  onSaved?: (profile: KnowledgeProfile) => void;
}

export function useKnowledgeProfile({ onLoaded, onSaved }: UseKnowledgeProfileOptions = {}) {
  const [knowledgeProfile, setKnowledgeProfile] = useState<KnowledgeProfile>({
    user_context: "",
    firm_context: "",
    updated_at: null,
  });
  const [profileDirty, setProfileDirty] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const loaded = await api.getKnowledgeProfile();
        if (cancelled) return;
        setKnowledgeProfile(loaded);
        setProfileDirty(false);
        onLoaded?.(loaded);
      } catch (e: unknown) {
        if (cancelled) return;
        setProfileError(e instanceof Error ? e.message : "Failed to load knowledge profile");
      }
    }
    load();
    return () => { cancelled = true; };
    // onLoaded intentionally excluded — only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateKnowledgeProfile = useCallback(
    (updates: Partial<Pick<KnowledgeProfile, "user_context" | "firm_context">>) => {
      setKnowledgeProfile((prev) => ({ ...prev, ...updates }));
      setProfileDirty(true);
    },
    []
  );

  const saveKnowledgeProfile = useCallback(async () => {
    setProfileSaving(true);
    setProfileError(null);
    try {
      const saved = await api.saveKnowledgeProfile({
        user_context: knowledgeProfile.user_context,
        firm_context: knowledgeProfile.firm_context,
      });
      setKnowledgeProfile(saved);
      setProfileDirty(false);
      onSaved?.(saved);
    } catch (e: unknown) {
      setProfileError(e instanceof Error ? e.message : "Failed to save knowledge profile");
    } finally {
      setProfileSaving(false);
    }
  }, [knowledgeProfile.user_context, knowledgeProfile.firm_context, onSaved]);

  return {
    knowledgeProfile,
    profileDirty,
    profileSaving,
    profileError,
    hasProfileContent: hasContent(knowledgeProfile),
    updateKnowledgeProfile,
    saveKnowledgeProfile,
  };
}
