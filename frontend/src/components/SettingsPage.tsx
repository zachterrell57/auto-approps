import { useState } from "react";
import { Eye, EyeOff, Key, Check, RefreshCw, Download } from "lucide-react";
import { validateAnthropicApiKey } from "@/lib/apiKey";
import type { AppSettings, UpdateStatus } from "@/lib/types";

interface SettingsPageProps {
  settings: AppSettings;
  saving: boolean;
  onSave: (apiKey: string) => boolean | Promise<boolean>;
  onShowOnboarding?: () => void | Promise<void>;
  onClearLocalData?: () => void | Promise<void>;
  appVersion?: string;
  updateStatus?: UpdateStatus | null;
  onCheckForUpdate?: () => void | Promise<void>;
  onInstallUpdate?: () => void;
}

export function SettingsPage({
  settings,
  saving,
  onSave,
  onShowOnboarding,
  onClearLocalData,
  appVersion,
  updateStatus,
  onCheckForUpdate,
  onInstallUpdate,
}: SettingsPageProps) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const dirty = apiKey.trim().length > 0;

  async function handleSave() {
    if (!dirty) return;
    const { normalizedKey, error } = validateAnthropicApiKey(apiKey);
    if (error) {
      setKeyError(error);
      return;
    }
    setKeyError(null);
    const saved = await onSave(normalizedKey);
    if (!saved) {
      return;
    }
    setApiKey("");
    setShowKey(false);
  }

  return (
    <div className="w-full max-w-xl mx-auto pt-6">
      {/* Header */}
      <div className="mb-12">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground leading-none">
          Settings
        </h1>
        <p className="mt-4 text-[15px] text-muted-foreground leading-relaxed">
          Configure your API credentials and preferences.
        </p>
      </div>

      <div className="space-y-10">
        {/* API Key */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <span
              className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold transition-all duration-300 ${
                settings.anthropic_api_key_set
                  ? "bg-emerald-500 text-white"
                  : "bg-amber-600/10 text-amber-700"
              }`}
            >
              {settings.anthropic_api_key_set ? (
                <Check className="w-3 h-3" strokeWidth={3} />
              ) : (
                <Key className="w-3 h-3" />
              )}
            </span>
            <span className="text-xs font-semibold tracking-[0.08em] uppercase text-foreground/50">
              Anthropic API Key
            </span>
          </div>

          {settings.anthropic_api_key_set && (
            <p className="text-xs text-foreground/35 mb-3">
              Current key: {settings.anthropic_api_key_preview}
            </p>
          )}

          <div className="flex gap-3">
            <div className="relative flex-1 group">
              <input
                type={showKey ? "text" : "password"}
                placeholder={
                  settings.anthropic_api_key_set
                    ? "Enter new key to replace..."
                    : "sk-ant-..."
                }
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  if (keyError) setKeyError(null);
                }}
                className="w-full h-12 pl-4 pr-10 rounded-xl border border-foreground/10 bg-transparent text-sm text-foreground placeholder:text-foreground/20 focus:outline-none focus:border-amber-400 focus:ring-[3px] focus:ring-amber-400/10 transition-all duration-200"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/20 hover:text-foreground/50 transition-colors"
                tabIndex={-1}
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <button
              onClick={() => {
                void handleSave();
              }}
              disabled={!dirty || saving}
              className="h-12 px-6 rounded-xl bg-foreground text-background text-sm font-medium tracking-wide transition-all duration-200 hover:shadow-lg hover:shadow-foreground/10 active:scale-[0.995] disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:shadow-none"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>

          {keyError && (
            <p className="text-xs text-rose-600 mt-3">{keyError}</p>
          )}

          {!settings.anthropic_api_key_set && !keyError && (
            <p className="text-xs text-amber-600 mt-3">
              An API key is required to map document fields to form questions.
            </p>
          )}

          <p className="text-xs text-foreground/40 mt-3">
            Alpha storage note: API keys and session data are stored locally in
            plaintext on this device.
          </p>
        </section>

        {onShowOnboarding && (
          <section>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-foreground/10 bg-foreground/[0.015] p-4">
              <div>
                <p className="text-sm font-medium text-foreground">Onboarding</p>
                <p className="text-xs text-foreground/60 mt-1">
                  Reopen the intro and API key setup screen.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void onShowOnboarding();
                }}
                className="h-10 px-4 rounded-lg border border-foreground/15 text-sm font-medium text-foreground/70 hover:bg-foreground/[0.03] transition-colors"
              >
                Show onboarding again
              </button>
            </div>
          </section>
        )}

        {appVersion && (
          <section>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs font-semibold tracking-[0.08em] uppercase text-foreground/50">
                Version
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-foreground/10 bg-foreground/[0.015] p-4">
              <div>
                <p className="text-sm font-medium text-foreground tabular-nums">
                  v{appVersion}
                </p>
                <p className="text-xs text-foreground/60 mt-1">
                  {updateStatus?.status === "checking"
                    ? "Checking for updates..."
                    : updateStatus?.status === "available"
                      ? "A new update is available. Downloading..."
                      : updateStatus?.status === "downloaded"
                        ? `Update${updateStatus.releaseName ? ` ${updateStatus.releaseName}` : ""} ready to install.`
                        : updateStatus?.status === "error"
                          ? "Update check failed. Try again later."
                          : "You're on the latest version."}
                </p>
              </div>
              <div className="flex gap-2">
                {updateStatus?.status === "downloaded" && onInstallUpdate ? (
                  <button
                    type="button"
                    onClick={onInstallUpdate}
                    className="h-10 px-4 rounded-lg bg-amber-600 text-sm font-medium text-white hover:bg-amber-700 transition-colors flex items-center gap-2"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Restart & Update
                  </button>
                ) : (
                  onCheckForUpdate && (
                    <button
                      type="button"
                      disabled={updateStatus?.status === "checking"}
                      onClick={() => {
                        void onCheckForUpdate();
                      }}
                      className="h-10 px-4 rounded-lg border border-foreground/15 text-sm font-medium text-foreground/70 hover:bg-foreground/[0.03] transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${updateStatus?.status === "checking" ? "animate-spin" : ""}`}
                      />
                      Check for Updates
                    </button>
                  )
                )}
              </div>
            </div>
          </section>
        )}

        {onClearLocalData && (
          <section>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200/60 bg-rose-50/40 p-4">
              <div>
                <p className="text-sm font-medium text-rose-700">Clear Local Data</p>
                <p className="text-xs text-rose-700/80 mt-1">
                  Deletes local sessions, clients, profile, and stored API key.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const confirmed = window.confirm(
                    "Clear all local data? This removes sessions, clients, profile, and API key.",
                  );
                  if (!confirmed) return;
                  void onClearLocalData();
                }}
                className="h-10 px-4 rounded-lg border border-rose-300/70 text-sm font-medium text-rose-700 hover:bg-rose-100/70 transition-colors"
              >
                Clear
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
