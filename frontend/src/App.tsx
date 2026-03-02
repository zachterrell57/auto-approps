import { useState, useCallback, useEffect, useRef } from "react";
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
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import type { MappingCompleteData } from "@/hooks/useFormFiller";

type Page = "main" | "profile" | "settings" | "clients";

export default function App() {
  const [page, setPage] = useState<Page>("main");
  const profile = useKnowledgeProfile();
  const clientManager = useClients();
  const sessionManager = useSessions();

  const handleMappingComplete = useCallback(
    (data: MappingCompleteData) => {
      sessionManager.saveSession(data);
    },
    [sessionManager.saveSession]
  );

  const formFiller = useFormFiller({
    onMappingComplete: handleMappingComplete,
  });

  const handleSelectSession = useCallback(
    async (id: string) => {
      const session = await sessionManager.loadSession(id);
      if (session) {
        formFiller.hydrateSession(session);
        setPage("main");
      }
    },
    [sessionManager.loadSession, formFiller.hydrateSession]
  );

  const handleNewSession = useCallback(() => {
    formFiller.reset();
    sessionManager.clearCurrentSession();
    setPage("main");
  }, [formFiller.reset, sessionManager.clearCurrentSession]);

  const handleDeleteSession = useCallback(
    async (id: string) => {
      await sessionManager.removeSession(id);
      if (sessionManager.currentSessionId === id) {
        formFiller.reset();
      }
    },
    [sessionManager.removeSession, sessionManager.currentSessionId, formFiller.reset]
  );

  // Debounced save of edited mappings
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!sessionManager.currentSessionId || formFiller.isHistorical === false && formFiller.step !== "answers") {
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      sessionManager.saveEditedMappings(formFiller.mappings);
    }, 2000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [formFiller.mappings, sessionManager.currentSessionId, sessionManager.saveEditedMappings, formFiller.step, formFiller.isHistorical]);

  const error = formFiller.error || profile.profileError;

  return (
    <SidebarProvider>
      <SessionSidebar
        sessions={sessionManager.sessions}
        currentSessionId={sessionManager.currentSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={sessionManager.renameSession}
        onNavigate={(p) => setPage(p)}
        activePage={page}
      />
      <SidebarInset>
        <header className="flex items-center gap-2 border-b border-foreground/8 px-5 h-12">
          <SidebarTrigger />
        </header>
        {error && (
          <div className="max-w-xl mx-auto mb-6 mt-4 px-4 py-3 rounded-xl border border-rose-200/60 bg-rose-50/50 text-sm text-rose-700">
            {error}
          </div>
        )}

        {page === "main" && formFiller.step === "answers" && formFiller.formSchema && (
          <AnswerSheetStep
            formSchema={formFiller.formSchema}
            mappings={formFiller.mappings}
            loading={formFiller.loading}
            debugDocBlobUrl={formFiller.debugDocBlobUrl}
            isHistorical={formFiller.isHistorical}
            onUpdate={formFiller.updateMapping}
            onRemap={formFiller.remap}
          />
        )}

        <div className="py-8 px-6">
          {page === "settings" && (
            <SettingsPage
              settings={formFiller.appSettings}
              saving={formFiller.settingsSaving}
              onSave={formFiller.saveAppSettings}
            />
          )}

          {page === "profile" && (
            <ProfilePage
              knowledgeProfile={profile.knowledgeProfile}
              profileDirty={profile.profileDirty}
              profileSaving={profile.profileSaving}
              onProfileChange={profile.updateKnowledgeProfile}
              onSaveProfile={profile.saveKnowledgeProfile}
            />
          )}

          {page === "clients" && (
            <ClientsPage
              clients={clientManager.clients}
              onCreateClient={clientManager.addClient}
              onUpdateClient={clientManager.editClient}
              onDeleteClient={clientManager.removeClient}
            />
          )}

          {page === "main" && formFiller.step === "upload" && (
            <UploadStep
              loading={formFiller.loading}
              clients={clientManager.clients}
              onProcess={formFiller.process}
              onLoadDebug={formFiller.loadDebugData}
            />
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
