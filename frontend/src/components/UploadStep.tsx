import { useState, useMemo, useEffect, useRef } from "react";
import {
  FileText,
  Link,
  Upload,
  ArrowRight,
  Check,
  X,
  Users,
  FileUp,
  Globe,
  Sparkles,
  ChevronDown,
  FileQuestion,
} from "lucide-react";
import type { Client, FormSchema, SavedForm, TargetKind } from "@/lib/types";
import type {
  ProcessRequest,
  ProcessingStage,
  TargetInputMode,
} from "@/hooks/useFormFiller";

interface UploadStepProps {
  loading: boolean;
  processingStage?: ProcessingStage;
  clients?: Client[];
  savedForms?: SavedForm[];
  formSchema?: FormSchema | null;
  apiKeyConfigured?: boolean;
  onProcess: (request: ProcessRequest) => void;
  onLoadDebug?: () => void;
  onOpenSettings?: () => void;
}

type StageEntry = {
  key: Exclude<ProcessingStage, null>;
  label: string;
  icon: typeof FileUp;
};

const BASE_STAGES: StageEntry[] = [
  { key: "reading_source" as const, label: "Reading source", icon: FileUp },
  { key: "preparing_target" as const, label: "Preparing target", icon: Globe },
  { key: "mapping" as const, label: "Mapping answers with AI", icon: Sparkles },
];

const DOCX_EXPORT_STAGE: StageEntry = {
  key: "generating_document" as const,
  label: "Generating filled DOCX",
  icon: FileQuestion,
};

function getStageIndex(
  stage: ProcessingStage,
  stages: ReadonlyArray<StageEntry>,
): number {
  if (!stage) return -1;
  return stages.findIndex((entry) => entry.key === stage);
}

function getVisibleProcessingStage(
  processingStage: ProcessingStage,
  targetKind: TargetKind | null,
): ProcessingStage {
  if (
    processingStage === "generating_document" &&
    targetKind !== "docx_questionnaire"
  ) {
    return null;
  }
  return processingStage;
}

function getActiveStages(
  processingStage: ProcessingStage,
  targetKind: TargetKind | null,
  hasSourceFile: boolean,
): StageEntry[] {
  const stages = hasSourceFile
    ? [...BASE_STAGES]
    : BASE_STAGES.filter((stage) => stage.key !== "reading_source");

  if (
    processingStage === "generating_document" &&
    targetKind === "docx_questionnaire"
  ) {
    stages.push(DOCX_EXPORT_STAGE);
  }

  return stages;
}

function isHttpUrl(value: string): boolean {
  if (!value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function FileDropzone(props: {
  id: string;
  label: string;
  hint: string;
  accept: string;
  file: File | null;
  required?: boolean;
  showHeader?: boolean;
  dragOver: boolean;
  onDragOver: (event: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent) => void;
  onSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
}) {
  const {
    id,
    label,
    hint,
    accept,
    file,
    required = false,
    showHeader = true,
    dragOver,
    onDragOver,
    onDragLeave,
    onDrop,
    onSelect,
    onClear,
  } = props;

  return (
    <section>
      {showHeader && (
        <div className="flex items-center gap-3 mb-4">
          <span
            className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold transition-all duration-300 ${
              file
                ? "bg-emerald-500 text-white"
                : "bg-amber-600/10 text-amber-700"
            }`}
          >
            {file ? <Check className="w-3 h-3" strokeWidth={3} /> : label}
          </span>
          <span className="text-xs font-semibold tracking-[0.08em] uppercase text-foreground/50">
            {hint}
            {!required && (
              <span className="font-normal text-foreground/30"> (optional)</span>
            )}
          </span>
        </div>
      )}

      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => document.getElementById(id)?.click()}
        className={`relative rounded-2xl border-2 border-dashed cursor-pointer transition-all duration-300 ease-out ${
          dragOver
            ? "border-amber-400 bg-amber-50 shadow-[0_0_0_4px_rgba(217,119,6,0.08)] scale-[1.005]"
            : file
              ? "border-emerald-300/80 bg-emerald-50/40"
              : "border-foreground/10 hover:border-foreground/20 hover:shadow-sm dot-grid"
        } ${file ? "py-5 px-6" : "py-14 px-8"}`}
      >
        <input
          id={id}
          type="file"
          accept={accept}
          onChange={onSelect}
          className="hidden"
        />

        {file ? (
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
              <FileText className="w-[18px] h-[18px] text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {(file.size / 1024).toFixed(0)} KB
              </p>
            </div>
            <button
              onClick={(event) => {
                event.stopPropagation();
                onClear();
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
                dragOver ? "bg-amber-200/60 scale-110" : "bg-foreground/[0.04]"
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
              Drop {required ? "the required" : "an optional"} file here or{" "}
              <span className="text-amber-600 font-medium">browse</span>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export function UploadStep({
  loading,
  processingStage,
  clients = [],
  savedForms = [],
  formSchema,
  apiKeyConfigured = true,
  onProcess,
  onLoadDebug,
  onOpenSettings,
}: UploadStepProps) {
  const [targetMode, setTargetMode] = useState<TargetInputMode>("web_form");
  const [targetUrl, setTargetUrl] = useState("");
  const [targetFile, setTargetFile] = useState<File | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [dragOverSource, setDragOverSource] = useState(false);
  const [dragOverTarget, setDragOverTarget] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [showUrlSuggestions, setShowUrlSuggestions] = useState(false);
  const formUrlPickerRef = useRef<HTMLDivElement | null>(null);

  const recentFormOptions = useMemo(() => {
    const seen = new Set<string>();
    const deduped: SavedForm[] = [];
    for (const target of savedForms) {
      const url = target.target_url.trim();
      if (target.target_kind !== "web_form" || !url || seen.has(url)) continue;
      seen.add(url);
      deduped.push(target);
      if (deduped.length >= 8) break;
    }
    return deduped;
  }, [savedForms]);

  const filteredRecentFormOptions = useMemo(() => {
    const query = targetUrl.trim().toLowerCase();
    if (!query) return recentFormOptions;
    return recentFormOptions.filter((target) => {
      const title = (target.target_title || target.display_name || "").toLowerCase();
      return target.target_url.toLowerCase().includes(query) || title.includes(query);
    });
  }, [recentFormOptions, targetUrl]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!formUrlPickerRef.current) return;
      if (!formUrlPickerRef.current.contains(event.target as Node)) {
        setShowUrlSuggestions(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  const isValidUrl = isHttpUrl(targetUrl);
  const canProcess =
    apiKeyConfigured &&
    !loading &&
    (targetMode === "web_form" ? isValidUrl : Boolean(targetFile));
  const targetKind = formSchema?.target_kind ?? null;
  const visibleProcessingStage = getVisibleProcessingStage(
    processingStage ?? null,
    targetKind,
  );
  const activeStages = getActiveStages(
    visibleProcessingStage,
    targetKind,
    Boolean(sourceFile),
  );
  const activeIndex = getStageIndex(visibleProcessingStage, activeStages);
  const formState = (formSchema?.form_state || "open").trim().toLowerCase();
  const showFormStateCard =
    Boolean(formSchema) &&
    formSchema?.target_kind === "web_form" &&
    formState !== "open" &&
    formState !== "unknown";
  const formStateMessage =
    formSchema?.form_state_message ||
    "This target could not be prepared in its current state.";
  const formStateLabel =
    formState === "needs_interaction"
      ? "Needs interaction"
      : formState.replace(/_/g, " ");

  if (loading && visibleProcessingStage) {
    return (
      <div className="w-full max-w-xl mx-auto pt-6">
        <div className="mb-12">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground leading-none">
            Processing
          </h1>
          <p className="mt-4 text-[15px] text-muted-foreground leading-relaxed max-w-md">
            Preparing answers from your selected target and evidence sources.
          </p>
        </div>

        <div className="mb-10">
          <div className="h-1 w-full rounded-full bg-foreground/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full bg-amber-500 transition-all duration-700 ease-out"
              style={{
                width: `${((activeIndex + 1) / activeStages.length) * 100}%`,
              }}
            />
          </div>
          <p className="mt-2.5 text-xs text-muted-foreground tabular-nums">
            Step {activeIndex + 1} of {activeStages.length}
          </p>
        </div>

        <div className="space-y-4">
          {activeStages.map((stage, index) => {
            const isDone = index < activeIndex;
            const isActive = index === activeIndex;
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

                <div className="ml-auto">
                  {isDone && (
                    <span className="text-[11px] font-medium text-emerald-600">Done</span>
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
      <div className="mb-12">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground leading-none">
          Generate Answers
        </h1>
        <p className="mt-4 text-[15px] text-muted-foreground leading-relaxed max-w-md">
          Choose a web form or document, then
          optionally add a source DOCX for evidence-backed answers.
        </p>
      </div>

      {showFormStateCard && (
        <div className="mb-8 rounded-2xl border border-amber-300/50 bg-amber-50/40 px-5 py-4">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-700/80">
            <Globe className="h-3.5 w-3.5" />
            Target state
          </div>
          <p className="mt-2 text-sm font-medium text-foreground">
            {formSchema?.title || "Web form"}
          </p>
          <p className="mt-1 text-sm text-amber-900/80">
            {formStateLabel}: {formStateMessage}
          </p>
        </div>
      )}

      <div className="space-y-10">
        <section>
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold bg-amber-600/10 text-amber-700">
              1
            </span>
            <span className="text-xs font-semibold tracking-[0.08em] uppercase text-foreground/50">
              Form type
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setTargetMode("web_form")}
              className={`rounded-2xl border px-4 py-4 text-left transition-all ${
                targetMode === "web_form"
                  ? "border-amber-300/70 bg-amber-50/40"
                  : "border-foreground/10 hover:border-foreground/20"
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Globe className="h-4 w-4" />
                Web Form
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Google Forms, Microsoft Forms, or another supported public form URL.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setTargetMode("questionnaire")}
              className={`rounded-2xl border px-4 py-4 text-left transition-all ${
                targetMode === "questionnaire"
                  ? "border-amber-300/70 bg-amber-50/40"
                  : "border-foreground/10 hover:border-foreground/20"
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <FileQuestion className="h-4 w-4" />
                Document
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Upload a `.docx` or text-based `.pdf` document.
              </p>
            </button>
          </div>

          <div className="mt-5">
            <p className="mb-3 text-xs font-semibold tracking-[0.08em] uppercase text-foreground/40">
              {targetMode === "web_form" ? "Web form URL" : "Document"}
            </p>

            {targetMode === "web_form" ? (
              <>
                <div ref={formUrlPickerRef} className="relative group">
                  <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-foreground/20 transition-colors group-focus-within:text-amber-500">
                    <Link className="w-4 h-4" />
                  </div>
                  <input
                    type="url"
                    placeholder="Paste or choose a recent web form URL..."
                    value={targetUrl}
                    onChange={(event) => {
                      setTargetUrl(event.target.value);
                      if (recentFormOptions.length > 0) {
                        setShowUrlSuggestions(true);
                      }
                    }}
                    onFocus={() => {
                      if (recentFormOptions.length > 0) {
                        setShowUrlSuggestions(true);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setShowUrlSuggestions(false);
                      } else if (event.key === "ArrowDown" && !showUrlSuggestions) {
                        setShowUrlSuggestions(true);
                      }
                    }}
                    className="w-full h-12 pl-11 pr-11 rounded-xl border border-foreground/10 bg-transparent text-sm text-foreground placeholder:text-foreground/20 focus:outline-none focus:border-amber-400 focus:ring-[3px] focus:ring-amber-400/10 transition-all duration-200"
                  />
                  {recentFormOptions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowUrlSuggestions((previous) => !previous)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-lg flex items-center justify-center text-foreground/35 hover:text-foreground/60 hover:bg-foreground/[0.04] transition-colors"
                      aria-label="Toggle recent form URLs"
                    >
                      <ChevronDown
                        className={`w-4 h-4 transition-transform ${
                          showUrlSuggestions ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                  )}

                  {showUrlSuggestions && recentFormOptions.length > 0 && (
                    <div className="absolute z-30 mt-2 w-full rounded-xl border border-foreground/10 bg-background shadow-xl overflow-hidden">
                      {filteredRecentFormOptions.length > 0 ? (
                        <div className="max-h-56 overflow-y-auto py-1">
                          {filteredRecentFormOptions.map((target) => (
                            <button
                              key={target.target_url}
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                setTargetUrl(target.target_url);
                                setShowUrlSuggestions(false);
                              }}
                              className="w-full px-3 py-2.5 text-left hover:bg-foreground/[0.03] transition-colors"
                            >
                              <p className="text-sm font-medium text-foreground truncate">
                                {target.target_title || target.display_name || "Recent web form"}
                              </p>
                              <p className="text-[11px] text-foreground/40 truncate mt-0.5">
                                {target.target_url}
                              </p>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="px-3 py-2.5 text-xs text-foreground/40">
                          No recent web form URLs match your input.
                        </p>
                      )}
                    </div>
                  )}
                </div>
                {recentFormOptions.length > 0 && (
                  <p className="mt-2 text-xs text-foreground/35">
                    Start typing to filter recent web form URLs.
                  </p>
                )}
              </>
            ) : (
              <FileDropzone
                id="target-file-input"
                label="1"
                hint="Document"
                accept=".docx,.pdf"
                file={targetFile}
                required
                showHeader={false}
                dragOver={dragOverTarget}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOverTarget(true);
                }}
                onDragLeave={() => setDragOverTarget(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOverTarget(false);
                  const dropped = event.dataTransfer.files[0];
                  if (dropped && /\.(docx|pdf)$/i.test(dropped.name)) {
                    setTargetFile(dropped);
                  }
                }}
                onSelect={(event) => {
                  const selected = event.target.files?.[0];
                  if (selected) setTargetFile(selected);
                }}
                onClear={() => setTargetFile(null)}
              />
            )}
          </div>
        </section>

        <FileDropzone
          id="source-file-input"
          label="2"
          hint="Knowledge source"
          accept=".docx"
          file={sourceFile}
          dragOver={dragOverSource}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOverSource(true);
          }}
          onDragLeave={() => setDragOverSource(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOverSource(false);
            const dropped = event.dataTransfer.files[0];
            if (dropped && /\.docx$/i.test(dropped.name)) {
              setSourceFile(dropped);
            }
          }}
          onSelect={(event) => {
            const selected = event.target.files?.[0];
            if (selected) setSourceFile(selected);
          }}
          onClear={() => setSourceFile(null)}
        />

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
                onChange={(event) => setSelectedClientId(event.target.value)}
                className="w-full h-12 pl-11 pr-4 rounded-xl border border-foreground/10 bg-transparent text-sm text-foreground focus:outline-none focus:border-amber-400 focus:ring-[3px] focus:ring-amber-400/10 transition-all duration-200 appearance-none cursor-pointer"
              >
                <option value="">No client selected</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </div>
          </section>
        )}

        {!apiKeyConfigured && (
          <div className="rounded-2xl border border-amber-300/50 bg-amber-50/40 p-4">
            <p className="text-sm text-amber-800">
              Add your Anthropic API key before processing targets.
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

        <div className="pt-2">
          <button
            disabled={!canProcess}
            onClick={() =>
              onProcess({
                inputMode: targetMode,
                sourceFile,
                targetUrl,
                targetFile,
                clientId: selectedClientId || undefined,
              })
            }
            className="group w-full h-[52px] rounded-2xl bg-foreground text-background text-sm font-medium tracking-wide transition-all duration-200 hover:shadow-lg hover:shadow-foreground/10 active:scale-[0.995] disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:active:scale-100 flex items-center justify-center gap-2.5"
          >
            {loading ? (
              <>
                <span className="h-4 w-4 border-2 border-background/20 border-t-background rounded-full animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              <>
                <span>Generate Answers</span>
                <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </>
            )}
          </button>
          {!apiKeyConfigured && (
            <p className="text-xs text-amber-600 mt-3">
              Set an Anthropic API key in Settings before processing.
            </p>
          )}
          {onLoadDebug && (
            <button
              type="button"
              onClick={onLoadDebug}
              className="mt-4 text-xs text-foreground/35 hover:text-foreground/60 transition-colors"
            >
              Load debug data
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
