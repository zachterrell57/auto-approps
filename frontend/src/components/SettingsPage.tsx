import { useState } from "react";
import { Eye, EyeOff, Key, Check } from "lucide-react";
import type { AppSettings } from "@/lib/types";

interface SettingsPageProps {
  settings: AppSettings;
  saving: boolean;
  onSave: (apiKey: string) => void;
}

export function SettingsPage({ settings, saving, onSave }: SettingsPageProps) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const dirty = apiKey.trim().length > 0;

  function handleSave() {
    if (!dirty) return;
    onSave(apiKey.trim());
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
                onChange={(e) => setApiKey(e.target.value)}
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
              onClick={handleSave}
              disabled={!dirty || saving}
              className="h-12 px-6 rounded-xl bg-foreground text-background text-sm font-medium tracking-wide transition-all duration-200 hover:shadow-lg hover:shadow-foreground/10 active:scale-[0.995] disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:shadow-none"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>

          {!settings.anthropic_api_key_set && (
            <p className="text-xs text-amber-600 mt-3">
              An API key is required to map document fields to form questions.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
