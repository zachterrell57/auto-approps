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
import { UpdateBanner } from "@/components/UpdateBanner";
import { SessionSidebar } from "@/components/SessionSidebar";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import type { MappingCompleteData } from "@/hooks/useFormFiller";
import type { AppSettings, SavedForm, SessionFull, UpdateStatus } from "@/lib/types";

type Page = "main" | "profile" | "settings" | "clients";
type UpdateBannerStatus = UpdateStatus & {
  status: "available" | "downloaded";
};

// ---------------------------------------------------------------------------
// Workflow descriptor — tracked by App, displayed in the sidebar
// ---------------------------------------------------------------------------

export interface WorkflowDescriptor {
  id: string;
  label: string;
  status: WorkflowStatus;
  /** Persisted session ID (set after save or when hydrating from history). */
  sessionId?: string;
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
    status: { step: "upload", processingStage: null, formTitle: null, targetKind: null },
  };
}

function workflowStatusEquals(a: WorkflowStatus, b: WorkflowStatus): boolean {
  return (
    a.step === b.step &&
    a.processingStage === b.processingStage &&
    a.formTitle === b.formTitle &&
    a.targetKind === b.targetKind
  );
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
    clearCurrentSession,
    setCurrentSession,
    refreshList,
  } = useSessions();

  // ── App version ────────────────────────────────────────────────────
  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    api.getAppVersion().then((v) => setAppVersion(v)).catch(() => {});
  }, []);

  // ── Auto-update listener ───────────────────────────────────────────
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const updateBannerStatus: UpdateBannerStatus | null =
    updateStatus?.status === "available" || updateStatus?.status === "downloaded"
      ? (updateStatus as UpdateBannerStatus)
      : null;

  useEffect(() => {
    const unsubscribe = api.onUpdateStatus((status) => {
      setUpdateStatus(status);
      if (status.status === "available" || status.status === "downloaded") {
        setUpdateDismissed(false);
      }
    });
    return unsubscribe;
  }, []);

  const handleCheckForUpdate = useCallback(async () => {
    await api.checkForUpdate();
  }, []);

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
      setWorkflows((prev) => {
        let changed = false;
        const next = prev.map((w) => {
          if (w.id !== wfId) return w;

          const nextLabel = status.formTitle || w.label;
          if (workflowStatusEquals(w.status, status) && w.label === nextLabel) {
            return w;
          }

          changed = true;
          return {
            ...w,
            status,
            label: nextLabel,
          };
        });

        return changed ? next : prev;
      });
    },
    [],
  );

  // When a workflow completes mapping → save as a session
  const handleMappingComplete = useCallback(
    async (data: MappingCompleteData) => {
      try {
        const sessionId = await saveSession(data);
        // Track the persisted session ID so edits can be autosaved
        if (sessionId) {
          setWorkflows((prev) =>
            prev.map((w) =>
              w.id === data.workflow_id ? { ...w, sessionId } : w,
            ),
          );
        }
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
      const existingWorkflow = workflows.find((workflow) => workflow.sessionId === id);
      if (existingWorkflow) {
        setCurrentSession(id);
        setActiveWorkflowId(existingWorkflow.id);
        setPage("main");
        return;
      }

      const session = await loadSession(id);
      if (!session) return;
      // Create a new workflow that hydrates from this session
      const wf: WorkflowDescriptor = {
        id: newWorkflowId(),
        label: session.display_name || session.target_title || "Session",
        status: {
          step: "answers",
          processingStage: null,
          formTitle: session.target_title,
          targetKind: session.target_kind,
        },
        sessionId: session.id,
        initialSession: session,
      };
      setWorkflows((prev) => [wf, ...prev]);
      setActiveWorkflowId(wf.id);
      setPage("main");
    },
    [loadSession, setCurrentSession, workflows],
  );

  const handleDeleteSession = useCallback(
    async (id: string) => {
      await removeSession(id);
      const removedWorkflowIds = workflows
        .filter((workflow) => workflow.sessionId === id)
        .map((workflow) => workflow.id);

      for (const workflowId of removedWorkflowIds) {
        void api.deleteWorkflow(workflowId);
      }

      setWorkflows((prev) => {
        const next = prev.filter((workflow) => workflow.sessionId !== id);
        if (next.length === 0) {
          const fresh = createEmptyWorkflow();
          setActiveWorkflowId(fresh.id);
          clearCurrentSession();
          return [fresh];
        }

        if (removedWorkflowIds.includes(activeWorkflowId)) {
          setActiveWorkflowId(next[0].id);
          if (next[0].sessionId) {
            setCurrentSession(next[0].sessionId);
          } else {
            clearCurrentSession();
          }
        }

        return next;
      });
    },
    [
      activeWorkflowId,
      clearCurrentSession,
      removeSession,
      setCurrentSession,
      workflows,
    ],
  );

  const handleSessionMappingsSaved = useCallback(() => {
    void refreshList();
  }, [refreshList]);

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
        {updateBannerStatus && !updateDismissed && (
          <UpdateBanner
            status={updateBannerStatus.status}
            releaseName={updateBannerStatus.releaseName}
            onInstall={() => void api.installUpdate()}
            onDismiss={() => setUpdateDismissed(true)}
          />
        )}
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

        {workflows.map((workflow) => {
          const isVisible =
            page === "main" &&
            !showOnboarding &&
            workflow.id === activeWorkflowId;

          return (
            <div
              key={workflow.id}
              className={isVisible ? "" : "hidden"}
              aria-hidden={!isVisible}
            >
              <WorkflowPanel
                workflowId={workflow.id}
                sessionId={workflow.sessionId}
                apiKeyConfigured={apiKeyConfigured}
                clients={clients}
                savedForms={savedForms}
                initialSession={workflow.initialSession}
                onStatusChange={handleWorkflowStatusChange}
                onMappingComplete={handleMappingComplete}
                onSessionMappingsSaved={handleSessionMappingsSaved}
                onOpenSettings={() => setPage("settings")}
              />
            </div>
          );
        })}

        <div className="py-8 px-6">
          {page === "settings" && (
            <SettingsPage
              settings={appSettings}
              saving={settingsSaving}
              onSave={saveAppSettings}
              onShowOnboarding={handleShowOnboarding}
              onClearLocalData={handleClearLocalData}
              appVersion={appVersion}
              updateStatus={updateStatus}
              onCheckForUpdate={handleCheckForUpdate}
              onInstallUpdate={() => void api.installUpdate()}
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
