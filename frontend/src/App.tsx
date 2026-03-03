import { useState, useCallback, useEffect } from "react";
import { X } from "lucide-react";
import * as api from "@/lib/api";
import { useClients } from "@/hooks/useClients";
import { useKnowledgeProfile } from "@/hooks/useKnowledgeProfile";
import { useSessions } from "@/hooks/useSessions";
import { WorkflowPanel } from "@/components/WorkflowPanel";
import type { WorkflowStatus } from "@/components/WorkflowPanel";
import { ClientsPage } from "@/components/ClientsPage";
import { SettingsPage } from "@/components/SettingsPage";
import { ProfilePage } from "@/components/ProfilePage";
import { OnboardingPage } from "@/components/OnboardingPage";
import { SessionSidebar } from "@/components/SessionSidebar";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import type { MappingCompleteData } from "@/hooks/useFormFiller";
import type { AppSettings, SavedForm, SessionFull } from "@/lib/types";

type Page = "main" | "profile" | "settings" | "clients";

// ---------------------------------------------------------------------------
// Workflow descriptor — tracked by App, displayed in the sidebar
// ---------------------------------------------------------------------------

export interface WorkflowDescriptor {
  id: string;
  label: string;
  status: WorkflowStatus;
  /** If set, the WorkflowPanel hydrates this session on mount. */
  initialSession?: SessionFull;
}

function newWorkflowId(): string {
  return crypto.randomUUID();
}

function createEmptyWorkflow(): WorkflowDescriptor {
  return {
    id: newWorkflowId(),
    label: "New Session",
    status: { step: "upload", processingStage: null, formTitle: null },
  };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [page, setPage] = useState<Page>("main");

  // ── Settings (global, not per-workflow) ─────────────────────────────
  const [appSettings, setAppSettings] = useState<AppSettings>({
    anthropic_api_key_set: false,
    anthropic_api_key_preview: "",
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getSettings()
      .then((s) => {
        if (!cancelled) setAppSettings(s);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSettingsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const apiKeyConfigured = appSettings.anthropic_api_key_set;

  const saveAppSettings = useCallback(async (apiKey: string) => {
    setSettingsSaving(true);
    try {
      const saved = await api.saveSettings({ anthropic_api_key: apiKey });
      setAppSettings(saved);
      return true;
    } catch {
      return false;
    } finally {
      setSettingsSaving(false);
    }
  }, []);

  // ── Knowledge profile ───────────────────────────────────────────────
  const {
    knowledgeProfile,
    profileDirty,
    profileSaving,
    profileError,
    updateKnowledgeProfile,
    saveKnowledgeProfile,
    reloadKnowledgeProfile,
  } = useKnowledgeProfile();

  // ── Clients ─────────────────────────────────────────────────────────
  const {
    clients,
    addClient,
    editClient,
    removeClient,
    refresh: refreshClients,
  } = useClients();

  // ── Sessions ────────────────────────────────────────────────────────
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

  // ── Workflows ───────────────────────────────────────────────────────
  const [workflows, setWorkflows] = useState<WorkflowDescriptor[]>(() => [
    createEmptyWorkflow(),
  ]);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string>(
    () => workflows[0].id,
  );

  // ── Saved forms (convenience feature from session history) ─────────
  const [savedForms, setSavedForms] = useState<SavedForm[]>([]);
  const refreshSavedForms = useCallback(async () => {
    try {
      const forms = await api.listSavedForms();
      setSavedForms(forms);
    } catch {
      // Non-fatal — saved forms are a convenience feature
    }
  }, []);

  useEffect(() => {
    void refreshSavedForms();
  }, [refreshSavedForms]);

  // Refresh saved forms whenever sessions list changes
  useEffect(() => {
    void refreshSavedForms();
  }, [sessions, refreshSavedForms]);

  const [sessionSaveError, setSessionSaveError] = useState<string | null>(null);

  // Update a workflow's status (called by WorkflowPanel via onStatusChange)
  const handleWorkflowStatusChange = useCallback(
    (wfId: string, status: WorkflowStatus) => {
      setWorkflows((prev) =>
        prev.map((w) =>
          w.id === wfId
            ? {
                ...w,
                status,
                label: status.formTitle || w.label,
              }
            : w,
        ),
      );
    },
    [],
  );

  // When a workflow completes mapping → save as a session
  const handleMappingComplete = useCallback(
    async (data: MappingCompleteData) => {
      try {
        await saveSession(data);
      } catch (err) {
        setSessionSaveError(
          `Failed to save session: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [saveSession],
  );

  // ── Sidebar: new session ────────────────────────────────────────────
  const handleNewSession = useCallback(() => {
    const wf = createEmptyWorkflow();
    setWorkflows((prev) => [wf, ...prev]);
    setActiveWorkflowId(wf.id);
    clearCurrentSession();
    setPage("main");
  }, [clearCurrentSession]);

  // ── Sidebar: select an in-progress workflow ─────────────────────────
  const handleSelectWorkflow = useCallback(
    (wfId: string) => {
      setActiveWorkflowId(wfId);
      clearCurrentSession();
      setPage("main");
    },
    [clearCurrentSession],
  );

  // ── Sidebar: discard an in-progress workflow ────────────────────────
  const handleDiscardWorkflow = useCallback(
    (wfId: string) => {
      // Clean up backend state
      void api.deleteWorkflow(wfId);
      setWorkflows((prev) => {
        const next = prev.filter((w) => w.id !== wfId);
        // If we removed the active one, switch to another or create new
        if (wfId === activeWorkflowId) {
          if (next.length > 0) {
            setActiveWorkflowId(next[0].id);
          } else {
            const fresh = createEmptyWorkflow();
            next.push(fresh);
            setActiveWorkflowId(fresh.id);
          }
        }
        return next;
      });
    },
    [activeWorkflowId],
  );

  // ── Sidebar: select a historical session ────────────────────────────
  const handleSelectSession = useCallback(
    async (id: string) => {
      const session = await loadSession(id);
      if (!session) return;
      // Create a new workflow that hydrates from this session
      const wf: WorkflowDescriptor = {
        id: newWorkflowId(),
        label: session.display_name || session.form_title || "Session",
        status: { step: "answers", processingStage: null, formTitle: session.form_title },
        initialSession: session,
      };
      setWorkflows((prev) => [wf, ...prev]);
      setActiveWorkflowId(wf.id);
      setPage("main");
    },
    [loadSession],
  );

  const handleDeleteSession = useCallback(
    async (id: string) => {
      await removeSession(id);
    },
    [removeSession],
  );

  // ── Settings: clear all local data ──────────────────────────────────
  const handleClearLocalData = useCallback(async () => {
    await api.clearLocalData();
    setAppSettings({ anthropic_api_key_set: false, anthropic_api_key_preview: "" });
    // Reset to single empty workflow
    const fresh = createEmptyWorkflow();
    setWorkflows([fresh]);
    setActiveWorkflowId(fresh.id);
    clearCurrentSession();
    await Promise.all([refreshList(), refreshClients(), reloadKnowledgeProfile(), refreshSavedForms()]);
    setOnboardingDismissedForSession(false);
    setOnboardingForcedOpen(false);
    setPage("main");
  }, [clearCurrentSession, refreshClients, refreshList, reloadKnowledgeProfile, refreshSavedForms]);

  // ── Onboarding ──────────────────────────────────────────────────────
  const [onboardingDismissedForSession, setOnboardingDismissedForSession] =
    useState(false);
  const [onboardingForcedOpen, setOnboardingForcedOpen] = useState(false);

  const handleShowOnboarding = useCallback(() => {
    setOnboardingDismissedForSession(false);
    setOnboardingForcedOpen(true);
    setPage("main");
  }, []);

  const handleOnboardingClose = useCallback(() => {
    setOnboardingForcedOpen(false);
    if (!apiKeyConfigured) {
      setOnboardingDismissedForSession(true);
    }
  }, [apiKeyConfigured]);

  const handleOnboardingSave = useCallback(
    async (apiKey: string) => {
      const saved = await saveAppSettings(apiKey);
      if (!saved) return;
      setOnboardingDismissedForSession(false);
      setOnboardingForcedOpen(false);
    },
    [saveAppSettings],
  );

  // ── Error display ───────────────────────────────────────────────────
  const rawError = profileError || sessionSaveError;
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const error = rawError && rawError !== dismissedError ? rawError : null;

  const showOnboarding =
    page === "main" &&
    settingsLoaded &&
    (onboardingForcedOpen ||
      (!apiKeyConfigured && !onboardingDismissedForSession));

  // Find the active workflow descriptor
  const activeWorkflow = workflows.find((w) => w.id === activeWorkflowId);

  return (
    <SidebarProvider>
      <SessionSidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        workflows={workflows}
        activeWorkflowId={activeWorkflowId}
        onSelectWorkflow={handleSelectWorkflow}
        onDiscardWorkflow={handleDiscardWorkflow}
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
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {page === "main" && !showOnboarding && activeWorkflow && (
          <WorkflowPanel
            key={activeWorkflow.id}
            workflowId={activeWorkflow.id}
            apiKeyConfigured={apiKeyConfigured}
            clients={clients}
            savedForms={savedForms}
            initialSession={activeWorkflow.initialSession}
            onStatusChange={handleWorkflowStatusChange}
            onMappingComplete={handleMappingComplete}
            onOpenSettings={() => setPage("settings")}
          />
        )}

        <div className="py-8 px-6">
          {page === "settings" && (
            <SettingsPage
              settings={appSettings}
              saving={settingsSaving}
              onSave={saveAppSettings}
              onShowOnboarding={handleShowOnboarding}
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

          {showOnboarding && (
            <OnboardingPage
              saving={settingsSaving}
              apiKeyConfigured={apiKeyConfigured}
              onSave={handleOnboardingSave}
              onClose={handleOnboardingClose}
            />
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
