import { useState, useCallback } from "react";
import { FileText, Link, Upload, ArrowRight, Check, X, Users, FileUp, Globe, Sparkles } from "lucide-react";
import type { Client } from "@/lib/types";
import type { ProcessingStage } from "@/hooks/useFormFiller";

interface UploadStepProps {
  loading: boolean;
  processingStage?: ProcessingStage;
  clients?: Client[];
  apiKeyConfigured?: boolean;
  onProcess: (file: File, formUrl: string, clientId?: string) => void;
  onLoadDebug?: () => void;
  onOpenSettings?: () => void;
}

const STAGES = [
  { key: "uploading" as const, label: "Reading document", icon: FileUp },
  { key: "scraping" as const, label: "Scraping form", icon: Globe },
  { key: "mapping" as const, label: "Mapping fields with AI", icon: Sparkles },
];

function getStageIndex(stage: ProcessingStage): number {
  if (!stage) return -1;
  return STAGES.findIndex((s) => s.key === stage);
}

export function UploadStep({
  loading,
  processingStage,
  clients = [],
  apiKeyConfigured = true,
  onProcess,
  onLoadDebug,
  onOpenSettings,
}: UploadStepProps) {
  const [file, setFile] = useState<File | null>(null);
  const [formUrl, setFormUrl] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string>("");

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && /\.docx$/i.test(dropped.name)) {
      setFile(dropped);
    }
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (selected) setFile(selected);
    },
    []
  );

  const isValid = (() => {
    if (!file || !formUrl.trim()) return false;
    try {
      const parsed = new URL(formUrl.trim());
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  })();

  const activeIndex = getStageIndex(processingStage ?? null);

  if (loading && processingStage) {
    return (
      <div className="w-full max-w-xl mx-auto pt-6">
        <div className="mb-12">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground leading-none">
            Processing
          </h1>
          <p className="mt-4 text-[15px] text-muted-foreground leading-relaxed max-w-md">
            Analyzing your document and mapping it to the form fields.
          </p>
        </div>

        {/* Progress bar */}
        <div className="mb-10">
          <div className="h-1 w-full rounded-full bg-foreground/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full bg-amber-500 transition-all duration-700 ease-out"
              style={{ width: `${((activeIndex + 1) / STAGES.length) * 100}%` }}
            />
          </div>
          <p className="mt-2.5 text-xs text-muted-foreground tabular-nums">
            Step {activeIndex + 1} of {STAGES.length}
          </p>
        </div>

        {/* Steps */}
        <div className="space-y-4">
          {STAGES.map((stage, i) => {
            const isDone = i < activeIndex;
            const isActive = i === activeIndex;
            const Icon = stage.icon;

            return (
              <div
                key={stage.key}
                className={`flex items-center gap-4 rounded-2xl border px-5 py-4 transition-all duration-500 ${
                  isActive
                    ? "border-amber-300/60 bg-amber-50/50 shadow-sm"
                    : isDone
                    ? "border-emerald-200/60 bg-emerald-50/30"
                    : "border-foreground/[0.06] bg-foreground/[0.015]"
                }`}
              >
                {/* Icon area */}
                <div
                  className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-500 ${
                    isActive
                      ? "bg-amber-500/15"
                      : isDone
                      ? "bg-emerald-500/15"
                      : "bg-foreground/[0.04]"
                  }`}
                >
                  {isDone ? (
                    <Check className="w-4 h-4 text-emerald-600" strokeWidth={2.5} />
                  ) : isActive ? (
                    <Icon className="w-4 h-4 text-amber-600 animate-pulse" />
                  ) : (
                    <Icon className="w-4 h-4 text-foreground/20" />
                  )}
                </div>

                {/* Label */}
                <span
                  className={`text-sm font-medium transition-colors duration-500 ${
                    isActive
                      ? "text-foreground"
                      : isDone
                      ? "text-emerald-700"
                      : "text-foreground/25"
                  }`}
                >
                  {stage.label}
                </span>

                {/* Status indicator */}
                <div className="ml-auto">
                  {isDone && (
                    <span className="text-[11px] font-medium text-emerald-600">
                      Done
                    </span>
                  )}
                  {isActive && (
                    <span className="h-4 w-4 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin block" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl mx-auto pt-6">
      {/* Header */}
      <div className="mb-12">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground leading-none">
          Upload & Map
        </h1>
        <p className="mt-4 text-[15px] text-muted-foreground leading-relaxed max-w-md">
          Upload a Word document and paste any web form URL to generate
          copy-ready answers for manual form entry.
        </p>
      </div>

      <div className="space-y-10">
        {/* Step 1 — Form URL */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <span
              className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold transition-all duration-300 ${
                isValid
                  ? "bg-emerald-500 text-white"
                  : "bg-amber-600/10 text-amber-700"
              }`}
            >
              {isValid ? <Check className="w-3 h-3" strokeWidth={3} /> : "1"}
            </span>
            <span className="text-xs font-semibold tracking-[0.08em] uppercase text-foreground/50">
              Form URL
            </span>
          </div>

          <div className="relative group">
            <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-foreground/20 transition-colors group-focus-within:text-amber-500">
              <Link className="w-4 h-4" />
            </div>
            <input
              type="url"
              placeholder="Paste any web form URL..."
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              className="w-full h-12 pl-11 pr-4 rounded-xl border border-foreground/10 bg-transparent text-sm text-foreground placeholder:text-foreground/20 focus:outline-none focus:border-amber-400 focus:ring-[3px] focus:ring-amber-400/10 transition-all duration-200"
            />
          </div>
        </section>

        {/* Step 2 — Document */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <span
              className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold transition-all duration-300 ${
                file
                  ? "bg-emerald-500 text-white"
                  : "bg-amber-600/10 text-amber-700"
              }`}
            >
              {file ? <Check className="w-3 h-3" strokeWidth={3} /> : "2"}
            </span>
            <span className="text-xs font-semibold tracking-[0.08em] uppercase text-foreground/50">
              Document
            </span>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById("file-input")?.click()}
            className={`relative rounded-2xl border-2 border-dashed cursor-pointer transition-all duration-300 ease-out ${
              dragOver
                ? "border-amber-400 bg-amber-50 shadow-[0_0_0_4px_rgba(217,119,6,0.08)] scale-[1.005]"
                : file
                ? "border-emerald-300/80 bg-emerald-50/40"
                : "border-foreground/10 hover:border-foreground/20 hover:shadow-sm dot-grid"
            } ${file ? "py-5 px-6" : "py-14 px-8"}`}
          >
            <input
              id="file-input"
              type="file"
              accept=".docx"
              onChange={handleFileInput}
              className="hidden"
            />

            {file ? (
              <div className="flex items-center gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                  <FileText className="w-[18px] h-[18px] text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {file.name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {(file.size / 1024).toFixed(0)} KB
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                  }}
                  className="flex-shrink-0 p-1.5 rounded-lg text-foreground/30 hover:text-foreground/60 hover:bg-foreground/5 transition-colors"
                  aria-label="Remove file"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="text-center">
                <div
                  className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 transition-all duration-300 ${
                    dragOver
                      ? "bg-amber-200/60 scale-110"
                      : "bg-foreground/[0.04]"
                  }`}
                >
                  <Upload
                    className={`w-6 h-6 transition-all duration-300 ${
                      dragOver
                        ? "text-amber-600 -translate-y-1"
                        : "text-foreground/25"
                    }`}
                    strokeWidth={1.5}
                  />
                </div>
                <p className="text-sm text-foreground/60">
                  Drop a{" "}
                  <span className="inline-block font-mono text-[12px] px-1.5 py-[2px] rounded-md bg-foreground/[0.05] text-foreground/40">
                    .docx
                  </span>{" "}
                  file here or{" "}
                  <span className="text-amber-600 font-medium">browse</span>
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Step 3 — Client (optional) */}
        {clients.length > 0 && (
          <section>
            <div className="flex items-center gap-3 mb-4">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold bg-amber-600/10 text-amber-700">
                3
              </span>
              <span className="text-xs font-semibold tracking-[0.08em] uppercase text-foreground/50">
                Client <span className="font-normal text-foreground/30">(optional)</span>
              </span>
            </div>

            <div className="relative group">
              <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-foreground/20 transition-colors group-focus-within:text-amber-500">
                <Users className="w-4 h-4" />
              </div>
              <select
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="w-full h-12 pl-11 pr-4 rounded-xl border border-foreground/10 bg-transparent text-sm text-foreground focus:outline-none focus:border-amber-400 focus:ring-[3px] focus:ring-amber-400/10 transition-all duration-200 appearance-none cursor-pointer"
              >
                <option value="">No client selected</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </section>
        )}

        {!apiKeyConfigured && (
          <div className="rounded-2xl border border-amber-300/50 bg-amber-50/40 p-4">
            <p className="text-sm text-amber-800">
              Add your Anthropic API key before processing documents.
            </p>
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="mt-3 h-9 px-3 rounded-lg border border-amber-300/60 text-xs font-semibold tracking-[0.06em] uppercase text-amber-800 hover:bg-amber-100/60 transition-colors"
              >
                Open Settings
              </button>
            )}
          </div>
        )}

        {/* Action */}
        <div className="pt-2">
          <button
            disabled={!isValid || loading || !apiKeyConfigured}
            onClick={() => file && onProcess(file, formUrl, selectedClientId || undefined)}
            className="group w-full h-[52px] rounded-2xl bg-foreground text-background text-sm font-medium tracking-wide transition-all duration-200 hover:shadow-lg hover:shadow-foreground/10 active:scale-[0.995] disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:active:scale-100 flex items-center justify-center gap-2.5"
          >
            <span>Process Document & Form</span>
            <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </button>
          {!apiKeyConfigured && (
            <p className="text-xs text-amber-600 mt-3">
              Set an Anthropic API key in Settings before processing.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-foreground/10 bg-foreground/[0.02] px-3 py-2 text-[12px] leading-relaxed text-foreground/50">
          Preflight note: only publicly accessible forms are supported.
          Login-gated forms may fail scraping.
        </div>

        {/* Debug (dev only) */}
        {import.meta.env.DEV && onLoadDebug && (
          <button
            onClick={onLoadDebug}
            className="w-full py-2.5 rounded-xl border border-dashed border-orange-300/50 text-orange-500/70 text-xs font-medium tracking-wide hover:bg-orange-50/40 transition-colors"
          >
            Load Debug Data
          </button>
        )}
      </div>
    </div>
  );
}
