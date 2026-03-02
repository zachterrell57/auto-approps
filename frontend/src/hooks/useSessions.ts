import { useState, useCallback, useEffect } from "react";
import * as api from "@/lib/api";
import type {
  FieldMapping,
  FormSchema,
  MappingResult,
  SessionFull,
  SessionMeta,
} from "@/lib/types";

export function useSessions() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshList = useCallback(async () => {
    try {
      const list = await api.listSessions();
      setSessions(list);
    } catch (err) {
      console.error("Failed to load sessions", err);
    }
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  const saveSession = useCallback(
    async (data: {
      document_filename: string;
      form_url: string;
      form_title: string;
      form_provider: string;
      form_schema: FormSchema;
      mapping_result: MappingResult;
    }): Promise<string | null> => {
      setLoading(true);
      try {
        const meta = await api.createSession(data);
        setCurrentSessionId(meta.id);
        await refreshList();
        // Fire-and-forget: generate AI name in the background
        api.generateSessionName(meta.id).then(() => refreshList()).catch(() => {});
        return meta.id;
      } catch (err) {
        console.error("Failed to save session", err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [refreshList]
  );

  const loadSession = useCallback(async (id: string): Promise<SessionFull | null> => {
    setLoading(true);
    try {
      const session = await api.getSession(id);
      setCurrentSessionId(id);
      return session;
    } catch (err) {
      console.error("Failed to load session", err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const removeSession = useCallback(
    async (id: string) => {
      try {
        await api.deleteSession(id);
        if (currentSessionId === id) {
          setCurrentSessionId(null);
        }
        await refreshList();
      } catch (err) {
        console.error("Failed to delete session", err);
      }
    },
    [currentSessionId, refreshList]
  );

  const saveEditedMappings = useCallback(
    async (mappings: FieldMapping[]) => {
      if (!currentSessionId) return;
      try {
        await api.updateSessionMappings(currentSessionId, mappings);
      } catch (err) {
        console.error("Failed to save edited mappings", err);
      }
    },
    [currentSessionId]
  );

  const renameSession = useCallback(
    async (id: string, displayName: string) => {
      try {
        await api.renameSession(id, displayName);
        await refreshList();
      } catch (err) {
        console.error("Failed to rename session", err);
      }
    },
    [refreshList]
  );

  const clearCurrentSession = useCallback(() => {
    setCurrentSessionId(null);
  }, []);

  return {
    sessions,
    currentSessionId,
    loading,
    saveSession,
    loadSession,
    removeSession,
    renameSession,
    saveEditedMappings,
    clearCurrentSession,
    refreshList,
  };
}
