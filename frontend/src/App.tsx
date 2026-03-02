import { useState, useCallback, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useClients } from "@/hooks/useClients";
import { useKnowledgeProfile } from "@/hooks/useKnowledgeProfile";
import { useFormFiller } from "@/hooks/useFormFiller";
import { useSessions } from "@/hooks/useSessions";
import { UploadStep } from "@/components/UploadStep";
import { AnswerSheetStep } from "@/components/AnswerSheetStep";
import { ClientsPage } from "@/components/ClientsPage";
import { SettingsPage } from "@/components/SettingsPage";
import { ProfilePage } from "@/components/ProfilePage";
import { SessionSidebar } from "@/components/SessionSidebar";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import type { MappingCompleteData } from "@/hooks/useFormFiller";

type Page = "main" | "profile" | "settings" | "clients";

export default function App() {
  const [page, setPage] = useState<Page>("main");
  const {
    knowledgeProfile,
    profileDirty,
    profileSaving,
    profileError,
    updateKnowledgeProfile,
    saveKnowledgeProfile,
    reloadKnowledgeProfile,
  } = useKnowledgeProfile();
  const {
    clients,
    addClient,
    editClient,
    removeClient,
    refresh: refreshClients,
  } = useClients();
  const {
    sessions,
    currentSessionId,
    saveSession,
    loadSession,
    removeSession,
    renameSession,
    saveEditedMappings,
    clearCurrentSession,
    refreshList,
  } = useSessions();

  const [sessionSaveError, setSessionSaveError] = useState<string | null>(null);

  const handleMappingComplete = useCallback(
    (data: MappingCompleteData) => {
      saveSession(data).catch((err) => {
        setSessionSaveError(
          `Failed to save session: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    },
    [saveSession],
  );

  const {
    step,
    loading,
    processingStage,
    settingsSaving,
    error: formError,
    apiKeyConfigured,
    formSchema,
    mappings,
    appSettings,
    debugDocBlobUrl,
    isHistorical,
    hasDocument,
    process,
    remap,
    updateMapping,
    saveAppSettings,
    clearAllLocalData,
    reset,
    hydrateSession,
    loadDebugData,
  } = useFormFiller({
    onMappingComplete: handleMappingComplete,
  });

  const handleSelectSession = useCallback(
    async (id: string) => {
      const session = await loadSession(id);
      if (session) {
        await hydrateSession(session);
        setPage("main");
      }
    },
    [loadSession, hydrateSession],
  );

  const handleNewSession = useCallback(() => {
    reset();
    clearCurrentSession();
    setPage("main");
  }, [reset, clearCurrentSession]);

  const handleDeleteSession = useCallback(
    async (id: string) => {
      await removeSession(id);
      if (currentSessionId === id) {
        reset();
      }
    },
    [removeSession, currentSessionId, reset],
  );

  const handleClearLocalData = useCallback(async () => {
    await clearAllLocalData();
    clearCurrentSession();
    await Promise.all([
      refreshList(),
      refreshClients(),
      reloadKnowledgeProfile(),
    ]);
    setPage("main");
  }, [
    clearAllLocalData,
    clearCurrentSession,
    refreshClients,
    refreshList,
    reloadKnowledgeProfile,
  ]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!currentSessionId || step !== "answers") {
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void saveEditedMappings(mappings);
    }, 2000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [currentSessionId, step, mappings, saveEditedMappings]);

  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const rawError = formError || profileError || sessionSaveError;
  const error = rawError && rawError !== dismissedError ? rawError : null;

  return (
    <SidebarProvider>
      <SessionSidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={renameSession}
        onNavigate={(p) => setPage(p)}
        activePage={page}
      />
      <SidebarInset>
        <header className="flex items-center gap-2 border-b border-foreground/8 px-5 h-12">
          <SidebarTrigger />
        </header>
        {error && (
          <div className="max-w-xl mx-auto mb-6 mt-4 px-4 py-3 rounded-xl border border-rose-200/60 bg-rose-50/50 text-sm text-rose-700 flex items-start gap-2">
            <span className="flex-1">{error}</span>
            <button
              onClick={() => setDismissedError(rawError)}
              className="shrink-0 text-rose-400 hover:text-rose-600 transition-colors p-0.5"
              title="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {page === "main" && step === "answers" && formSchema && (
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

        <div className="py-8 px-6">
          {page === "settings" && (
            <SettingsPage
              settings={appSettings}
              saving={settingsSaving}
              onSave={saveAppSettings}
              onClearLocalData={handleClearLocalData}
            />
          )}

          {page === "profile" && (
            <ProfilePage
              knowledgeProfile={knowledgeProfile}
              profileDirty={profileDirty}
              profileSaving={profileSaving}
              onProfileChange={updateKnowledgeProfile}
              onSaveProfile={saveKnowledgeProfile}
            />
          )}

          {page === "clients" && (
            <ClientsPage
              clients={clients}
              onCreateClient={addClient}
              onUpdateClient={editClient}
              onDeleteClient={removeClient}
            />
          )}

          {page === "main" && step === "upload" && (
            <UploadStep
              loading={loading}
              processingStage={processingStage}
              clients={clients}
              apiKeyConfigured={apiKeyConfigured}
              onProcess={process}
              onLoadDebug={loadDebugData}
              onOpenSettings={() => setPage("settings")}
            />
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
