import { useState } from "react";
import { Settings, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppSettings } from "@/lib/types";

interface SettingsPanelProps {
  settings: AppSettings;
  saving: boolean;
  onSave: (apiKey: string) => void;
}

export function SettingsPanel({ settings, saving, onSave }: SettingsPanelProps) {
  const [open, setOpen] = useState(!settings.anthropic_api_key_set);
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
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        title="Settings"
      >
        <Settings className="h-5 w-5" />
      </button>

      {open && (
        <section className="mt-4 space-y-3 border rounded-lg p-4 bg-gray-50/60">
          <h3 className="text-sm font-semibold text-gray-900">Settings</h3>

          <div className="space-y-2">
            <label className="text-sm font-medium">Anthropic API Key</label>
            {settings.anthropic_api_key_set && (
              <p className="text-xs text-gray-500">
                Current key: {settings.anthropic_api_key_preview}
              </p>
            )}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKey ? "text" : "password"}
                  placeholder={
                    settings.anthropic_api_key_set
                      ? "Enter new key to replace..."
                      : "sk-ant-..."
                  }
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!dirty || saving}
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>

          {!settings.anthropic_api_key_set && (
            <p className="text-xs text-amber-600">
              An API key is required to map document fields to form questions.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
