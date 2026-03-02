import { useState } from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  FileText,
  Key,
  Link as LinkIcon,
  Sparkles,
} from "lucide-react";
import { validateAnthropicApiKey } from "@/lib/apiKey";

interface OnboardingPageProps {
  saving: boolean;
  apiKeyConfigured: boolean;
  onSave: (apiKey: string) => void | Promise<void>;
  onClose: () => void;
}

const USE_CASE_STEPS = [
  {
    icon: LinkIcon,
    title: "Paste form URL",
    description:
      "Start with a public web form link from Google Forms, Microsoft Forms, or another supported provider.",
  },
  {
    icon: FileText,
    title: "Add source context",
    description:
      "Optionally upload a .docx file and pick a client profile to improve answer quality.",
  },
  {
    icon: Sparkles,
    title: "Review generated answers",
    description:
      "AutoApprops maps source context to each question so you can copy answers into the form.",
  },
];

export function OnboardingPage({
  saving,
  apiKeyConfigured,
  onSave,
  onClose,
}: OnboardingPageProps) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const dirty = apiKey.trim().length > 0;

  async function handleSave() {
    if (!dirty) {
      setKeyError("Enter your Anthropic API key to continue.");
      return;
    }

    const { normalizedKey, error } = validateAnthropicApiKey(apiKey);
    if (error) {
      setKeyError(error);
      return;
    }

    setKeyError(null);
    await onSave(normalizedKey);
  }

  return (
    <div className="w-full max-w-3xl mx-auto pt-6">
      <div className="mb-10">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground leading-none">
          Welcome to AutoApprops
        </h1>
        <p className="mt-4 text-[15px] text-muted-foreground leading-relaxed max-w-2xl">
          AutoApprops helps you prepare form responses faster by mapping your
          documents and saved context to form questions, then giving you a
          copy-ready answer sheet for manual submission.
        </p>
      </div>

      <section className="rounded-2xl border border-foreground/8 bg-foreground/[0.015] p-5 mb-8">
        <h2 className="text-xs font-semibold tracking-[0.08em] uppercase text-foreground/40 mb-4">
          How it works
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {USE_CASE_STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <article
                key={step.title}
                className="rounded-xl border border-foreground/8 bg-background/70 p-4"
              >
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/12 text-amber-700">
                  <Icon className="w-4 h-4" />
                </span>
                <p className="mt-3 text-sm font-medium text-foreground">
                  {step.title}
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-foreground/8 p-5">
        <div className="flex items-center gap-3 mb-4">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-600/10 text-amber-700">
            <Key className="w-3.5 h-3.5" />
          </span>
          <span className="text-xs font-semibold tracking-[0.08em] uppercase text-foreground/50">
            Anthropic API Key
          </span>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          Add your key to enable AI field mapping.
        </p>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                if (keyError) setKeyError(null);
              }}
              placeholder="sk-ant-..."
              className="w-full h-12 pl-4 pr-10 rounded-xl border border-foreground/10 bg-transparent text-sm text-foreground placeholder:text-foreground/20 focus:outline-none focus:border-amber-400 focus:ring-[3px] focus:ring-amber-400/10 transition-all duration-200"
            />
            <button
              type="button"
              onClick={() => setShowKey((value) => !value)}
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
            type="button"
            onClick={() => {
              void handleSave();
            }}
            disabled={!dirty || saving}
            className="h-12 px-5 rounded-xl bg-foreground text-background text-sm font-medium tracking-wide transition-all duration-200 hover:shadow-lg hover:shadow-foreground/10 active:scale-[0.995] disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:shadow-none inline-flex items-center gap-2"
          >
            {saving ? (
              "Saving..."
            ) : (
              <>
                <span>Save API Key</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>

        {keyError && <p className="text-xs text-rose-600 mt-3">{keyError}</p>}

        <p className="text-xs text-foreground/40 mt-3">
          Alpha storage note: API keys and session data are stored locally in
          plaintext on this device.
        </p>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 h-10 px-4 rounded-lg border border-foreground/12 text-sm font-medium text-foreground/65 hover:text-foreground hover:bg-foreground/[0.02] transition-colors"
        >
          {apiKeyConfigured ? "Close" : "Skip for now"}
        </button>
      </section>
    </div>
  );
}
