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
  onOpenSettings,
}: WorkflowPanelProps) {
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

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
    onStatusChangeRef.current(workflowId, {
      step,
      processingStage,
      formTitle: formSchema?.title ?? null,
    });
  }, [workflowId, step, processingStage, formSchema?.title]);

  // Debounced autosave of mapping edits when a session is persisted
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const initialMappingsRef = useRef(true);

  useEffect(() => {
    // Skip the first render (initial load / hydration)
    if (initialMappingsRef.current) {
      initialMappingsRef.current = false;
      return;
    }
    if (!sessionIdRef.current || !mappings || mappings.length === 0) return;
    const sid = sessionIdRef.current;
    const timer = setTimeout(() => {
      void api.updateSessionMappings(sid, mappings);
    }, 1000);
    return () => clearTimeout(timer);
  }, [mappings]);

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
