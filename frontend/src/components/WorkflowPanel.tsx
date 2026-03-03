import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useFormFiller } from "@/hooks/useFormFiller";
import type { MappingCompleteData, ProcessingStage, Step } from "@/hooks/useFormFiller";
import { UploadStep } from "@/components/UploadStep";
import { AnswerSheetStep } from "@/components/AnswerSheetStep";
import * as api from "@/lib/api";
import type { Client, SavedForm, SessionFull } from "@/lib/types";

export interface WorkflowStatus {
  step: Step;
  processingStage: ProcessingStage;
  formTitle: string | null;
}

interface WorkflowPanelProps {
  workflowId: string;
  /** Persisted session ID — enables autosave of mapping edits. */
  sessionId?: string;
  apiKeyConfigured: boolean;
  clients: Client[];
  savedForms?: SavedForm[];
  /** If provided, the panel hydrates this session on mount (for viewing historical sessions). */
  initialSession?: SessionFull;
  onStatusChange: (workflowId: string, status: WorkflowStatus) => void;
  onMappingComplete: (data: MappingCompleteData) => void;
  onSessionMappingsSaved?: () => void;
  onOpenSettings: () => void;
}

export function WorkflowPanel({
  workflowId,
  sessionId,
  apiKeyConfigured,
  clients,
  savedForms,
  initialSession,
  onStatusChange,
  onMappingComplete,
  onSessionMappingsSaved,
  onOpenSettings,
}: WorkflowPanelProps) {
  const {
    step,
    loading,
    processingStage,
    error,
    formSchema,
    mappings,
    debugDocBlobUrl,
    isHistorical,
    hasDocument,
    process,
    remap,
    updateMapping,
    hydrateSession,
    loadDebugData,
  } = useFormFiller({
    workflowId,
    apiKeyConfigured,
    onMappingComplete,
  });

  // Hydrate from a historical session on mount
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (initialSession && !hydratedRef.current) {
      hydratedRef.current = true;
      void hydrateSession(initialSession);
    }
  }, [initialSession, hydrateSession]);

  // Report status changes to parent for sidebar display
  useEffect(() => {
    onStatusChange(workflowId, {
      step,
      processingStage,
      formTitle: formSchema?.title ?? null,
    });
  }, [workflowId, step, processingStage, formSchema?.title, onStatusChange]);

  // Debounced autosave of mapping edits when a session is persisted.
  // For each session, skip the first non-empty mappings snapshot so opening/hydrating
  // a historical session does not count as an edit.
  const autosaveSessionRef = useRef<string | null>(null);
  const skipNextAutosaveRef = useRef(true);

  useEffect(() => {
    if (sessionId !== autosaveSessionRef.current) {
      autosaveSessionRef.current = sessionId ?? null;
      skipNextAutosaveRef.current = true;
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !mappings || mappings.length === 0) return;
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }
    const sid = sessionId;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          await api.updateSessionMappings(sid, mappings);
          onSessionMappingsSaved?.();
        } catch (err) {
          console.error("Failed to autosave session mappings", err);
        }
      })();
    }, 1000);
    return () => clearTimeout(timer);
  }, [mappings, onSessionMappingsSaved, sessionId]);

  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const visibleError = error && error !== dismissedError ? error : null;

  return (
    <>
      {visibleError && (
        <div className="max-w-xl mx-auto mb-6 mt-4 px-4 py-3 rounded-xl border border-rose-200/60 bg-rose-50/50 text-sm text-rose-700 flex items-start gap-2">
          <span className="flex-1">{visibleError}</span>
          <button
            onClick={() => setDismissedError(error)}
            className="shrink-0 text-rose-400 hover:text-rose-600 transition-colors p-0.5"
            title="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {step === "answers" && formSchema && (
        <AnswerSheetStep
          workflowId={workflowId}
          formSchema={formSchema}
          mappings={mappings}
          loading={loading}
          apiKeyConfigured={apiKeyConfigured}
          hasDocument={hasDocument}
          debugDocBlobUrl={debugDocBlobUrl}
          isHistorical={isHistorical}
          onUpdate={updateMapping}
          onRemap={remap}
        />
      )}

      {step === "upload" && (
        <div className="py-8 px-6">
          <UploadStep
            loading={loading}
            processingStage={processingStage}
            clients={clients}
            savedForms={savedForms}
            apiKeyConfigured={apiKeyConfigured}
            onProcess={process}
            onLoadDebug={loadDebugData}
            onOpenSettings={onOpenSettings}
          />
        </div>
      )}
    </>
  );
}
