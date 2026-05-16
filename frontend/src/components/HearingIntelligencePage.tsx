import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Check,
  Download,
  FileText,
  Filter,
  Loader2,
  MessageSquare,
  Play,
  Plus,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHearingJobs } from "@/hooks/useHearingJobs";
import { hearingOutputCostLabel } from "@/lib/hearingCost";
import type {
  AppSettings,
  Client,
  HearingClientContext,
  HearingExportFormat,
  HearingMode,
  HearingOutput,
  HearingOutputType,
  HearingTranscriptSegment,
  HearingWatchItemDraft,
  HearingYoutubeSource,
} from "@/lib/types";

interface HearingIntelligencePageProps {
  clients: Client[];
  settings: AppSettings;
  onOpenClients: () => void;
}

const emptyContext: Partial<HearingClientContext> = {
  aliases: [],
  tickers: [],
  subsidiaries: [],
  products: [],
  competitors: [],
  trade_associations: [],
  industry_tags: [],
  agencies: [],
  committees: [],
  priority_bills: [],
  amendments: [],
  regulations: [],
  programs: [],
  budget_accounts: [],
  geographies: [],
  facilities: [],
  key_people: [],
  care_about: "",
  ignore_unless_directly_mentioned: "",
  preferred_output_style: "formal_memo",
  confidential_internal_notes: "",
};

function parseList(value: string): string[] {
  return value
    .split(/,|\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function listText(values: string[] | undefined): string {
  return (values ?? []).join(", ");
}

function clientLabel(name: string): string {
  return name.trim() || "No client";
}

function youtubeSourceLabel(source: HearingYoutubeSource | null | undefined): string {
  if (!source) return "No YouTube video detected";
  const status =
    source.live_status === "recorded"
      ? "recorded video"
      : source.live_status === "scheduled"
        ? "scheduled"
        : source.live_status === "live"
          ? "live"
          : "YouTube video";
  return [source.title || source.video_id, source.channel, status]
    .filter(Boolean)
    .join(" · ");
}

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function dateLabel(value: string | null): string {
  if (!value) return "Date pending";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function statusTone(status: string): string {
  if (status === "failed") return "text-rose-700 bg-rose-50 border-rose-200";
  if (status === "exported" || status === "ready_for_review") {
    return "text-emerald-700 bg-emerald-50 border-emerald-200";
  }
  if (
    status === "analyzing" ||
    status === "transcribing" ||
    status === "resolving" ||
    status === "capturing" ||
    status === "finalizing"
  ) {
    return "text-amber-700 bg-amber-50 border-amber-200";
  }
  return "text-foreground/60 bg-foreground/[0.03] border-foreground/10";
}

function confidenceTone(value: number): string {
  if (value >= 0.85) return "text-emerald-700";
  if (value >= 0.65) return "text-amber-700";
  return "text-rose-700";
}

function ListField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[] | undefined;
  onChange: (value: string[]) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-foreground/45">
        {label}
      </span>
      <textarea
        value={listText(value)}
        onChange={(event) => onChange(parseList(event.target.value))}
        className="mt-2 w-full min-h-[64px] rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-amber-400 focus:ring-[3px] focus:ring-amber-400/10"
      />
    </label>
  );
}

function NewJobForm({
  clients,
  disabled,
  onCreate,
  onOpenClients,
}: {
  clients: Client[];
  disabled: boolean;
  onCreate: (args: {
    clientId: string;
    sourceUrl: string;
    mode: HearingMode;
    context: Partial<HearingClientContext>;
    watchItems: HearingWatchItemDraft[];
  }) => Promise<void>;
  onOpenClients: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [mode, setMode] = useState<HearingMode>("full_memo");
  const [context, setContext] = useState<Partial<HearingClientContext>>(emptyContext);
  const [watchText, setWatchText] = useState("");
  const canCreate = Boolean(sourceUrl.trim());

  const handleCreate = async () => {
    const watchItems: HearingWatchItemDraft[] = parseList(watchText).map((label) => ({
      type: /^\s*(H\.?\s*R\.?|S\.|H\.?\s*Res\.?|S\.?\s*Res\.?)/i.test(label)
        ? "bill"
        : "topic",
      label,
      aliases: [],
      match_mode: "hybrid",
      importance: "medium",
      negative_filters: [],
    }));
    await onCreate({
      clientId,
      sourceUrl,
      mode,
      context,
      watchItems,
    });
    setSourceUrl("");
    setWatchText("");
  };

  return (
    <section className="border-b border-foreground/8 bg-white">
      <div className="space-y-4 px-6 py-5">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Live Hearing Intelligence
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Capture committee YouTube audio, detect client hits, and generate same-day briefings.
              </p>
            </div>
            {clients.length === 0 && (
              <Button variant="outline" onClick={onOpenClients} type="button">
                <Plus />
                Client
              </Button>
            )}
          </div>
          <div className="grid gap-3 lg:grid-cols-[220px_1fr_190px_auto]">
            <label className="block">
              <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-foreground/45">
                Client (optional)
              </span>
              <select
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                className="mt-2 h-10 w-full rounded-lg border border-foreground/10 bg-white px-3 text-sm outline-none focus:border-amber-400"
              >
                <option value="">No client selected</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-foreground/45">
                Committee Page URL
              </span>
              <input
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                className="mt-2 h-10 w-full rounded-lg border border-foreground/10 bg-white px-3 text-sm outline-none focus:border-amber-400"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-foreground/45">
                Mode
              </span>
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as HearingMode)}
                className="mt-2 h-10 w-full rounded-lg border border-foreground/10 bg-white px-3 text-sm outline-none focus:border-amber-400"
              >
                <option value="full_memo">Full memo</option>
                <option value="watchlist">Watchlist</option>
                <option value="pre_hearing">Pre-hearing</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </label>
            <Button
              className="mt-6"
              disabled={!canCreate || disabled}
              onClick={() => void handleCreate()}
            >
              {disabled ? <Loader2 className="animate-spin" /> : <Plus />}
              Create
            </Button>
          </div>
        </div>
        <details className="group rounded-lg border border-foreground/8 bg-foreground/[0.015]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium outline-none transition hover:bg-foreground/[0.025] focus-visible:ring-[3px] focus-visible:ring-amber-400/20 [&::-webkit-details-marker]:hidden">
            <span>Additional information</span>
            <ChevronDown className="h-4 w-4 text-foreground/45 transition group-open:rotate-180" />
          </summary>
          <div className="grid gap-4 border-t border-foreground/8 p-4 xl:grid-cols-[1fr_1fr]">
            <label className="block">
              <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-foreground/45">
                Watch Items
              </span>
              <textarea
                value={watchText}
                onChange={(event) => setWatchText(event.target.value)}
                className="mt-2 min-h-[70px] w-full rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <ListField
                label="Aliases / products"
                value={[...(context.aliases ?? []), ...(context.products ?? [])]}
                onChange={(values) =>
                  setContext((prev) => ({
                    ...prev,
                    aliases: values,
                    products: [],
                  }))
                }
              />
              <ListField
                label="Bills / amendments"
                value={[
                  ...(context.priority_bills ?? []),
                  ...(context.amendments ?? []),
                ]}
                onChange={(values) =>
                  setContext((prev) => ({
                    ...prev,
                    priority_bills: values,
                    amendments: [],
                  }))
                }
              />
              <ListField
                label="Agencies / committees"
                value={[...(context.agencies ?? []), ...(context.committees ?? [])]}
                onChange={(values) =>
                  setContext((prev) => ({
                    ...prev,
                    agencies: values,
                    committees: [],
                  }))
                }
              />
              <label className="block">
                <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-foreground/45">
                  Care About
                </span>
                <textarea
                  value={context.care_about ?? ""}
                  onChange={(event) =>
                    setContext((prev) => ({
                      ...prev,
                      care_about: event.target.value,
                    }))
                  }
                  className="mt-2 min-h-[64px] w-full rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
                />
              </label>
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}

function TranscriptPane({
  segments,
  activeSegmentIds,
  billSegmentIds,
  onMarkSegment,
}: {
  segments: HearingTranscriptSegment[];
  activeSegmentIds: Set<string>;
  billSegmentIds: Set<string>;
  onMarkSegment: (segmentId: string, status: "verified" | "needs_review") => void;
}) {
  const [filter, setFilter] = useState<"all" | "low" | "relevant" | "bills">("all");
  const [query, setQuery] = useState("");
  const visible = segments.filter((segment) => {
    if (
      query.trim() &&
      !`${segment.speakerLabel} ${segment.text}`
        .toLowerCase()
        .includes(query.trim().toLowerCase())
    ) {
      return false;
    }
    if (filter === "low") {
      return segment.asrConfidence < 0.8 || segment.speakerConfidence < 0.65;
    }
    if (filter === "relevant") return activeSegmentIds.has(segment.segmentId);
    if (filter === "bills") return billSegmentIds.has(segment.segmentId);
    return true;
  });

  return (
    <section className="min-h-0 border-r border-foreground/8 bg-white">
      <div className="flex h-12 items-center justify-between border-b border-foreground/8 px-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Radio className="h-4 w-4 text-foreground/45" />
          Transcript
        </div>
        <div className="flex items-center gap-1">
          {(["all", "low", "relevant", "bills"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`h-7 rounded-md px-2 text-xs capitalize ${
                filter === value
                  ? "bg-foreground text-background"
                  : "text-foreground/50 hover:bg-foreground/[0.04]"
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
      <div className="border-b border-foreground/8 px-4 py-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 w-full rounded-md border border-foreground/10 px-2 text-xs outline-none focus:border-amber-400"
        />
      </div>
      <div className="h-[680px] overflow-auto px-4 py-3">
        {visible.length === 0 && (
          <p className="py-12 text-center text-sm text-foreground/35">
            No transcript segments.
          </p>
        )}
        <div className="space-y-2">
          {visible.map((segment) => (
            <div
              key={segment.segmentId}
              id={segment.segmentId}
              className={`rounded-lg border p-3 ${
                activeSegmentIds.has(segment.segmentId)
                  ? "border-amber-300 bg-amber-50/40"
                  : "border-foreground/8"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{segment.speakerLabel}</p>
                  <p className="mt-0.5 text-[11px] text-foreground/35">
                    {formatMs(segment.startMs)}-{formatMs(segment.endMs)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="rounded p-1 text-foreground/35 hover:bg-emerald-50 hover:text-emerald-700"
                    title="Verify"
                    onClick={() => onMarkSegment(segment.segmentId, "verified")}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="rounded p-1 text-foreground/35 hover:bg-amber-50 hover:text-amber-700"
                    title="Needs review"
                    onClick={() => onMarkSegment(segment.segmentId, "needs_review")}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-foreground/80">
                {segment.text}
              </p>
              <div className="mt-2 flex gap-3 text-[11px]">
                <span className={confidenceTone(segment.asrConfidence)}>
                  ASR {Math.round(segment.asrConfidence * 100)}%
                </span>
                <span className={confidenceTone(segment.speakerConfidence)}>
                  Speaker {Math.round(segment.speakerConfidence * 100)}%
                </span>
                <span className="text-foreground/35">{segment.reviewStatus}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function OutputPane({
  output,
  claims,
  comments,
  onSave,
  onRegenerate,
  onClaimStatus,
  onComment,
  onJumpToSegment,
}: {
  output: HearingOutput | null;
  claims: Array<{
    id: string;
    claim_text: string;
    verification_status: string;
    confidence: number;
    supporting_segment_ids: string[];
  }>;
  comments: Array<{ id: string; comment: string; target_id: string }>;
  onSave: (markdown: string, verified: boolean) => void;
  onRegenerate: (instructions: string) => void;
  onClaimStatus: (claimId: string, status: "supported" | "weak_support" | "unsupported" | "needs_review") => void;
  onComment: (comment: string) => void;
  onJumpToSegment: (segmentId: string) => void;
}) {
  const [markdown, setMarkdown] = useState(output?.content_markdown ?? "");
  const [instructions, setInstructions] = useState("");
  const [comment, setComment] = useState("");
  const costLabel = output ? hearingOutputCostLabel(output.model_metadata) : "";

  return (
    <section className="min-h-0 bg-white">
      <div className="flex h-12 items-center justify-between border-b border-foreground/8 px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <FileText className="h-4 w-4 shrink-0 text-foreground/45" />
          <span>Memo</span>
          {costLabel && (
            <span className="truncate rounded-md border border-foreground/8 bg-foreground/[0.025] px-2 py-0.5 text-xs font-normal text-foreground/50">
              {costLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={!output} onClick={() => onSave(markdown, false)}>
            Save
          </Button>
          <Button size="sm" disabled={!output} onClick={() => onSave(markdown, true)}>
            <ShieldCheck />
            Verify
          </Button>
        </div>
      </div>
      <div className="h-[720px] overflow-auto p-4">
        <textarea
          value={markdown}
          onChange={(event) => setMarkdown(event.target.value)}
          className="min-h-[420px] w-full resize-y rounded-lg border border-foreground/10 bg-white p-4 font-mono text-[13px] leading-relaxed outline-none focus:border-amber-400"
        />
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
          <input
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            className="h-9 rounded-lg border border-foreground/10 px-3 text-sm outline-none focus:border-amber-400"
          />
          <Button
            variant="outline"
            disabled={!instructions.trim()}
            onClick={() => {
              onRegenerate(instructions);
              setInstructions("");
            }}
          >
            <Sparkles />
            Regenerate
          </Button>
        </div>
        <div className="mt-5">
          <h3 className="text-sm font-semibold">Claims</h3>
          <div className="mt-2 space-y-2">
            {claims.map((claim) => (
              <div key={claim.id} className="rounded-lg border border-foreground/8 p-3">
                <p className="text-sm leading-relaxed">{claim.claim_text}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-foreground/45">
                  <span className={confidenceTone(claim.confidence)}>
                    {Math.round(claim.confidence * 100)}%
                  </span>
                  <span>{claim.verification_status}</span>
                  {claim.supporting_segment_ids.length > 0 ? (
                    claim.supporting_segment_ids.map((segmentId) => (
                      <button
                        key={segmentId}
                        className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 hover:bg-amber-100"
                        onClick={() => onJumpToSegment(segmentId)}
                      >
                        {segmentId}
                      </button>
                    ))
                  ) : (
                    <span>No transcript support</span>
                  )}
                  <button
                    className="ml-auto text-emerald-700 hover:underline"
                    onClick={() => onClaimStatus(claim.id, "supported")}
                  >
                    supported
                  </button>
                  <button
                    className="text-amber-700 hover:underline"
                    onClick={() => onClaimStatus(claim.id, "needs_review")}
                  >
                    review
                  </button>
                </div>
              </div>
            ))}
            {claims.length === 0 && (
              <p className="py-5 text-center text-sm text-foreground/35">
                No claims generated.
              </p>
            )}
          </div>
        </div>
        <div className="mt-5">
          <h3 className="text-sm font-semibold">Comments</h3>
          <div className="mt-2 flex gap-2">
            <input
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              className="h-9 flex-1 rounded-lg border border-foreground/10 px-3 text-sm outline-none focus:border-amber-400"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!comment.trim()}
              onClick={() => {
                onComment(comment);
                setComment("");
              }}
            >
              <MessageSquare />
              Add
            </Button>
          </div>
          <div className="mt-2 space-y-1">
            {comments.slice(0, 5).map((entry) => (
              <p key={entry.id} className="rounded-md bg-foreground/[0.03] px-3 py-2 text-xs">
                {entry.comment}
              </p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function HearingIntelligencePage({
  clients,
  settings,
  onOpenClients,
}: HearingIntelligencePageProps) {
  const {
    jobs,
    workspace,
    loading,
    busyLabel,
    error,
    createJob,
    loadWorkspace,
    resolveStream,
    startCapture,
    stopCapture,
    refreshCaptureStatus,
    saveWatchlist,
    detectHits,
    generateOutput,
    generateFinalBrief,
    saveOutput,
    markSegment,
    updateHitStatus,
    updateClaimStatus,
    addComment,
    exportResults,
    setError,
  } = useHearingJobs();
  const [streamOverride, setStreamOverride] = useState("");
  const [watchDraft, setWatchDraft] = useState<HearingWatchItemDraft[]>([]);
  const [outputType, setOutputType] = useState<HearingOutputType>("full_memo");

  const selectedOutput = workspace?.outputs[0] ?? null;
  const activeSegmentIds = useMemo(
    () => new Set(workspace?.watch_hits.flatMap((hit) => hit.transcriptSegmentIds) ?? []),
    [workspace?.watch_hits],
  );
  const billSegmentIds = useMemo(() => {
    if (!workspace) return new Set<string>();
    const billItemIds = new Set(
      workspace.watch_items
        .filter((item) => item.type === "bill")
        .map((item) => item.id),
    );
    return new Set(
      workspace.watch_hits
        .filter((hit) => billItemIds.has(hit.watchItemId))
        .flatMap((hit) => hit.transcriptSegmentIds),
    );
  }, [workspace]);
  const outputClaims = useMemo(
    () =>
      selectedOutput
        ? workspace?.claims.filter(
            (claim) => claim.hearing_output_id === selectedOutput.id,
          ) ?? []
        : [],
    [selectedOutput, workspace?.claims],
  );

  const selectJob = async (id: string) => {
    const next = await loadWorkspace(id);
    setWatchDraft(
      next.watch_items.map((item) => ({
        id: item.id,
        type: item.type,
        label: item.label,
        aliases: item.aliases,
        match_mode: item.match_mode,
        importance: item.importance,
        negative_filters: item.negative_filters,
      })),
    );
    setOutputType(
      next.job.mode === "watchlist"
        ? "targeted_recap"
        : next.job.mode === "pre_hearing"
          ? "pre_hearing_brief"
          : "full_memo",
    );
    setStreamOverride("");
  };

  const currentId = workspace?.job.id ?? "";
  const captureStatus = workspace?.job.capture_status ?? "idle";
  const transcriptionStatus = workspace?.job.transcription_status ?? "idle";
  const captureRunning =
    captureStatus === "running" ||
    captureStatus === "starting" ||
    captureStatus === "stopping";
  const youtubeSource = workspace?.job.metadata.youtube_source ?? null;
  const mediaToolsReady = settings.yt_dlp_available && settings.ffmpeg_available;
  const mediaToolMessage = !settings.yt_dlp_available
    ? `YouTube extractor unavailable${settings.yt_dlp_error ? `: ${settings.yt_dlp_error}` : ""}`
    : !settings.ffmpeg_available
      ? `ffmpeg unavailable${settings.ffmpeg_error ? `: ${settings.ffmpeg_error}` : ""}`
      : "";
  const scheduledDetected =
    youtubeSource?.live_status === "scheduled" && !streamOverride.trim();
  const canStartCapture = Boolean(
    mediaToolsReady &&
      !loading &&
      !captureRunning &&
      !scheduledDetected &&
      (workspace?.job.stream_url || streamOverride.trim()),
  );

  useEffect(() => {
    if (!currentId) return undefined;
    const shouldPoll = captureRunning || transcriptionStatus === "transcribing";
    if (!shouldPoll) return undefined;
    const timer = window.setInterval(() => {
      void refreshCaptureStatus(currentId).catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    }, 8000);
    return () => window.clearInterval(timer);
  }, [
    captureRunning,
    currentId,
    refreshCaptureStatus,
    setError,
    transcriptionStatus,
  ]);

  return (
    <div className="min-h-[calc(100vh-3rem)] bg-[#f7f7f4]">
      <NewJobForm
        clients={clients}
        disabled={loading}
        onOpenClients={onOpenClients}
        onCreate={async ({ clientId, sourceUrl, mode, context, watchItems }) => {
          await createJob({
            client_id: clientId || undefined,
            source_url: sourceUrl,
            mode,
            client_context: context,
            watch_items: watchItems,
          });
        }}
      />

      {error && (
        <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="h-4 w-4" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-rose-500">
            Dismiss
          </button>
        </div>
      )}

      {busyLabel && (
        <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Loader2 className="h-4 w-4 animate-spin" />
          {busyLabel}
        </div>
      )}

      <div className="grid gap-0 px-6 py-5 xl:grid-cols-[320px_1fr]">
        <aside className="border border-foreground/8 bg-white">
          <div className="flex h-11 items-center gap-2 border-b border-foreground/8 px-3 text-sm font-medium">
            <Search className="h-4 w-4 text-foreground/45" />
            Jobs
          </div>
          <div className="max-h-[830px] overflow-auto p-2">
            {jobs.map((job) => (
              <button
                key={job.id}
                onClick={() => void selectJob(job.id)}
                className={`mb-2 block w-full rounded-lg border p-3 text-left transition ${
                  workspace?.job.id === job.id
                    ? "border-amber-300 bg-amber-50/45"
                    : "border-foreground/8 hover:bg-foreground/[0.025]"
                }`}
              >
                <p className="truncate text-sm font-medium">
                  {job.hearing_title || "Metadata pending"}
                </p>
                <p className="mt-1 truncate text-xs text-foreground/40">
                  {clientLabel(job.client_name)} · {job.committee || job.mode} · {job.capture_status.replaceAll("_", " ")}
                </p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className={`rounded border px-2 py-0.5 text-[11px] ${statusTone(job.status)}`}>
                    {job.status.replaceAll("_", " ")}
                  </span>
                  <span className="text-[11px] text-foreground/35">
                    {job.watch_hit_count} hits · {job.output_count} docs
                  </span>
                </div>
              </button>
            ))}
            {jobs.length === 0 && (
              <p className="py-10 text-center text-sm text-foreground/35">
                No hearing jobs.
              </p>
            )}
          </div>
        </aside>

        <main className="border-y border-r border-foreground/8 bg-white">
          {!workspace && (
            <div className="flex h-[720px] items-center justify-center text-sm text-foreground/35">
              Select or create a hearing job.
            </div>
          )}
          {workspace && (
            <>
              <div className="border-b border-foreground/8 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold tracking-tight">
                        {workspace.job.hearing_title || "Metadata pending"}
                      </h2>
                      <span className={`rounded border px-2 py-0.5 text-[11px] ${statusTone(workspace.job.status)}`}>
                        {workspace.job.status.replaceAll("_", " ")}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-foreground/45">
                      {clientLabel(workspace.job.client_name)} · {workspace.job.committee || "Committee pending"} · {dateLabel(workspace.job.hearing_datetime)}
                    </p>
                    <p className="mt-1 truncate text-xs text-foreground/35">
                      {workspace.job.source_url}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => void resolveStream(currentId)} disabled={loading}>
                      <Search />
                      Resolve YouTube
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void detectHits(currentId)} disabled={loading || workspace.transcript_segments.length === 0}>
                      <Filter />
                      Detect
                    </Button>
                    <select
                      value={outputType}
                      onChange={(event) => setOutputType(event.target.value as HearingOutputType)}
                      className="h-8 rounded-md border border-foreground/10 bg-white px-2 text-xs"
                    >
                      <option value="full_memo">Full memo</option>
                      <option value="targeted_recap">Targeted recap</option>
                      <option value="pre_hearing_brief">Pre-hearing brief</option>
                      <option value="transcript">Transcript package</option>
                      <option value="mention_log">Mention log</option>
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void startCapture(currentId, streamOverride.trim() || undefined)}
                      disabled={!canStartCapture}
                    >
                      <Play />
                      Start Capture
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        void (async () => {
                          if (captureRunning) await stopCapture(currentId);
                          await generateFinalBrief(currentId, outputType);
                        })();
                      }}
                      disabled={
                        loading ||
                        (workspace.transcript_segments.length === 0 && !captureRunning)
                      }
                    >
                      <Sparkles />
                      {captureRunning ? "Stop + Generate" : "Generate Final"}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid border-b border-foreground/8 p-4 lg:grid-cols-[1fr_1fr]">
                <div className="space-y-3 pr-0 lg:pr-4">
                  <div className="rounded-lg border border-foreground/8 bg-foreground/[0.015] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">YouTube Capture</h3>
                        <p className="mt-1 text-xs text-foreground/45">
                          {workspace.job.stream_url
                            ? youtubeSourceLabel(youtubeSource)
                            : "Resolve the hearing page to find its YouTube video."}
                        </p>
                      </div>
                      <span className={`rounded border px-2 py-0.5 text-[11px] ${statusTone(workspace.job.status)}`}>
                        {workspace.job.capture_status.replaceAll("_", " ")}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2">
                      <label className="block">
                        <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-foreground/45">
                          Detected YouTube Video
                        </span>
                        <input
                          value={workspace.job.stream_url || ""}
                          readOnly
                          className="mt-2 h-9 w-full rounded-lg border border-foreground/10 bg-white px-3 text-xs text-foreground/55 outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-foreground/45">
                          Override YouTube URL or Video ID
                        </span>
                        <input
                          value={streamOverride}
                          onChange={(event) => setStreamOverride(event.target.value)}
                          className="mt-2 h-9 w-full rounded-lg border border-foreground/10 bg-white px-3 text-sm outline-none focus:border-amber-400"
                        />
                      </label>
                      {mediaToolMessage && (
                        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          {mediaToolMessage}
                        </p>
                      )}
                      {!workspace.job.stream_url && !streamOverride.trim() && (
                        <p className="rounded-md border border-foreground/10 bg-foreground/[0.015] px-3 py-2 text-xs text-foreground/45">
                          No YouTube video is ready for capture. Resolve YouTube or paste a YouTube video URL.
                        </p>
                      )}
                      {scheduledDetected && (
                        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          This YouTube video is scheduled but not live yet.
                        </p>
                      )}
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-md border border-foreground/8 bg-white p-2">
                        <p className="text-foreground/40">Chunks</p>
                        <p className="mt-1 font-medium">{workspace.job.audio_chunk_count}</p>
                      </div>
                      <div className="rounded-md border border-foreground/8 bg-white p-2">
                        <p className="text-foreground/40">Transcript</p>
                        <p className="mt-1 font-medium">{workspace.transcript_segments.length}</p>
                      </div>
                      <div className="rounded-md border border-foreground/8 bg-white p-2">
                        <p className="text-foreground/40">ASR</p>
                        <p className="mt-1 font-medium">{workspace.job.transcription_status}</p>
                      </div>
                    </div>
                    {workspace.job.capture_error && (
                      <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                        {workspace.job.capture_error}
                      </p>
                    )}
                    {Array.isArray(workspace.job.metadata.warnings) &&
                      workspace.job.metadata.warnings.length > 0 && (
                        <p className="mt-3 text-xs text-amber-700">
                          {(workspace.job.metadata.warnings as string[]).slice(0, 2).join(" ")}
                        </p>
                      )}
                  </div>
                </div>
                <div className="space-y-2 border-t border-foreground/8 pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Watchlist</h3>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        setWatchDraft((prev) => [
                          ...prev,
                          {
                            type: "topic",
                            label: "",
                            aliases: [],
                            match_mode: "hybrid",
                            importance: "medium",
                            negative_filters: [],
                          },
                        ])
                      }
                    >
                      <Plus />
                      Item
                    </Button>
                  </div>
                  <div className="max-h-[154px] overflow-auto space-y-2">
                    {watchDraft.map((item, index) => (
                      <div key={item.id ?? index} className="grid gap-2 lg:grid-cols-[110px_1fr_100px_32px]">
                        <select
                          value={item.type}
                          onChange={(event) =>
                            setWatchDraft((prev) =>
                              prev.map((draft, draftIndex) =>
                                draftIndex === index
                                  ? { ...draft, type: event.target.value as HearingWatchItemDraft["type"] }
                                  : draft,
                              ),
                            )
                          }
                          className="h-8 rounded-md border border-foreground/10 bg-white px-2 text-xs"
                        >
                          <option value="bill">Bill</option>
                          <option value="topic">Topic</option>
                          <option value="person">Person</option>
                          <option value="organization">Org</option>
                          <option value="phrase">Phrase</option>
                          <option value="agency">Agency</option>
                          <option value="geography">Geo</option>
                        </select>
                        <input
                          value={item.label}
                          onChange={(event) =>
                            setWatchDraft((prev) =>
                              prev.map((draft, draftIndex) =>
                                draftIndex === index ? { ...draft, label: event.target.value } : draft,
                              ),
                            )
                          }
                          className="h-8 rounded-md border border-foreground/10 px-2 text-xs outline-none focus:border-amber-400"
                        />
                        <select
                          value={item.importance}
                          onChange={(event) =>
                            setWatchDraft((prev) =>
                              prev.map((draft, draftIndex) =>
                                draftIndex === index
                                  ? { ...draft, importance: event.target.value as HearingWatchItemDraft["importance"] }
                                  : draft,
                              ),
                            )
                          }
                          className="h-8 rounded-md border border-foreground/10 bg-white px-2 text-xs"
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="critical">Critical</option>
                        </select>
                        <button
                          onClick={() =>
                            setWatchDraft((prev) => prev.filter((_draft, draftIndex) => draftIndex !== index))
                          }
                          className="rounded-md text-foreground/35 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="mx-auto h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void saveWatchlist(currentId, watchDraft)}
                    disabled={loading}
                  >
                    Save Watchlist
                  </Button>
                </div>
              </div>

              <div className="grid xl:grid-cols-[0.95fr_1.05fr]">
                <TranscriptPane
                  segments={workspace.transcript_segments}
                  activeSegmentIds={activeSegmentIds}
                  billSegmentIds={billSegmentIds}
                  onMarkSegment={(segmentId, status) => void markSegment(currentId, segmentId, status)}
                />
                <OutputPane
                  key={selectedOutput?.id ?? "empty-output"}
                  output={selectedOutput}
                  claims={outputClaims}
                  comments={workspace.comments}
                  onSave={(markdown, verified) =>
                    selectedOutput &&
                    void saveOutput(
                      currentId,
                      selectedOutput.id,
                      markdown,
                      verified ? "verified" : "needs_review",
                    )
                  }
                  onRegenerate={(instructions) =>
                    void generateOutput(currentId, outputType, instructions)
                  }
                  onClaimStatus={(claimId, status) =>
                    void updateClaimStatus(currentId, claimId, status)
                  }
                  onComment={(comment) =>
                    void addComment(
                      currentId,
                      "output",
                      selectedOutput?.id ?? currentId,
                      comment,
                    )
                  }
                  onJumpToSegment={(segmentId) =>
                    document
                      .getElementById(segmentId)
                      ?.scrollIntoView({ behavior: "smooth", block: "center" })
                  }
                />
              </div>

              <div className="border-t border-foreground/8 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">Hits</span>
                  {workspace.watch_hits.map((hit) => (
                    <button
                      key={hit.hitId}
                      onClick={() => {
                        const first = hit.transcriptSegmentIds[0];
                        if (first) document.getElementById(first)?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                      className={`rounded-md border px-2 py-1 text-xs ${
                        hit.status === "dismissed"
                          ? "border-foreground/8 text-foreground/30 line-through"
                          : "border-amber-200 bg-amber-50 text-amber-800"
                      }`}
                    >
                      {hit.triggerText} · {formatMs(hit.startMs)}
                    </button>
                  ))}
                  <div className="ml-auto flex flex-wrap gap-2">
                    {(["markdown", "docx", "pdf", "html", "csv", "json", "transcript"] as HearingExportFormat[]).map((format) => (
                      <Button
                        key={format}
                        size="xs"
                        variant="outline"
                        disabled={
                          loading ||
                          (["markdown", "docx", "pdf", "html"].includes(format) &&
                            selectedOutput?.review_status !== "verified")
                        }
                        onClick={() => void exportResults(currentId, format, selectedOutput?.id)}
                      >
                        <Download />
                        {format}
                      </Button>
                    ))}
                  </div>
                </div>
                {workspace.watch_hits.length > 0 && (
                  <div className="mt-3 grid gap-2 lg:grid-cols-2">
                    {workspace.watch_hits.slice(0, 6).map((hit) => (
                      <div key={hit.hitId} className="rounded-lg border border-foreground/8 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium">{hit.triggerText}</p>
                            <p className="mt-1 text-xs text-foreground/45">
                              {hit.speakerLabels.join(", ") || "Unknown speaker"} · {Math.round(hit.confidence * 100)}%
                            </p>
                          </div>
                          <div className="flex gap-1">
                            <button
                              className="rounded px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50"
                              onClick={() => void updateHitStatus(currentId, hit.hitId, "reviewed")}
                            >
                              review
                            </button>
                            <button
                              className="rounded px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                              onClick={() => void updateHitStatus(currentId, hit.hitId, "dismissed")}
                            >
                              dismiss
                            </button>
                          </div>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-foreground/60">
                          {hit.clientRelevance}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
