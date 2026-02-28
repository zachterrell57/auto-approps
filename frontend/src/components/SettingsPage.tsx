import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl">Settings</CardTitle>
        <CardDescription>
          Configure your API credentials and preferences.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium">Anthropic API Key</label>
          {settings.anthropic_api_key_set && (
            <p className="text-xs text-muted-foreground">
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
              onClick={handleSave}
              disabled={!dirty || saving}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
          {!settings.anthropic_api_key_set && (
            <p className="text-xs text-amber-600">
              An API key is required to map document fields to form questions.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
