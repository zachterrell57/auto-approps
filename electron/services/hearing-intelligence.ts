import {
  getCongressionalContext,
  type CongressionalContext,
} from "./congressional-context";
import { getClient } from "./client-store";
import { generateHearingOutput } from "./hearing-ai";
import { exportHearingWorkspace } from "./hearing-export";
import {
  getLiveHearingCaptureStatus,
  startLiveHearingCapture,
  stopLiveHearingCapture,
} from "./hearing-live-capture";
import {
  HearingClientContextSchema,
  HearingExportFormatEnum,
  HearingOutputTypeEnum,
  HearingWatchItemDraftSchema,
  type HearingClientContext,
  type HearingCreateInput,
  type HearingExportFormat,
  type HearingJob,
  type HearingOutputType,
  type HearingTranscriptSegment,
  type HearingWatchItemDraft,
  type HearingYoutubeSource,
  type ReviewStatus,
  type TranscriptSource,
  type VerificationStatus,
  type WatchHitStatus,
} from "./hearing-models";
import { resolveHearingSource } from "./hearing-source-resolver";
import { probeYoutubeSource } from "./media-tools";
import { normalizeYoutubeVideoInput } from "./youtube-source";
import {
  addHearingComment,
  applyResolvedMetadata,
  createHearingJob,
  getHearingJob,
  getHearingWorkspace,
  listHearingJobs,
  replaceTranscriptSegments,
  replaceWatchHits,
  replaceWatchItems,
  updateHearingCaptureState,
  updateHearingClaimStatus,
  updateHearingMetadata,
  updateHearingJobStatus,
  updateHearingOutput,
  updateTranscriptSegmentReview,
  updateWatchHitStatus,
} from "./hearing-store";
import {
  fetchTranscriptFromUrl,
  parseTranscriptText,
  transcribeMediaFromUrl,
  transcriptText,
} from "./hearing-transcript";
import { detectWatchlistHits } from "./hearing-watchlist";

function parseList(raw: string, label: string): string[] {
  const lines = raw
    .split(/\n|;/)
    .map((line) => line.trim())
    .filter(Boolean);
  const prefix = `${label.toLowerCase()}:`;
  for (const line of lines) {
    if (line.toLowerCase().startsWith(prefix)) {
      return line
        .slice(prefix.length)
        .split(/,|\|/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function contextFromClientKnowledge(knowledge: string): Partial<HearingClientContext> {
  return {
    aliases: parseList(knowledge, "aliases"),
    subsidiaries: parseList(knowledge, "subsidiaries"),
    products: parseList(knowledge, "products"),
    competitors: parseList(knowledge, "competitors"),
    trade_associations: parseList(knowledge, "trade associations"),
    industry_tags: parseList(knowledge, "industry tags"),
    agencies: parseList(knowledge, "agencies"),
    committees: parseList(knowledge, "committees"),
    priority_bills: parseList(knowledge, "priority bills"),
    amendments: parseList(knowledge, "amendments"),
    programs: parseList(knowledge, "programs"),
    geographies: parseList(knowledge, "geographies"),
    key_people: parseList(knowledge, "key people"),
    care_about: knowledge.trim(),
    confidential_internal_notes: knowledge.trim(),
  };
}

function mergeContext(
  base: Partial<HearingClientContext>,
  overlay: Partial<HearingClientContext>,
): HearingClientContext {
  const merged = HearingClientContextSchema.parse({
    ...base,
    ...overlay,
    aliases: [...(base.aliases ?? []), ...(overlay.aliases ?? [])],
    tickers: [...(base.tickers ?? []), ...(overlay.tickers ?? [])],
    subsidiaries: [...(base.subsidiaries ?? []), ...(overlay.subsidiaries ?? [])],
    products: [...(base.products ?? []), ...(overlay.products ?? [])],
    competitors: [...(base.competitors ?? []), ...(overlay.competitors ?? [])],
    trade_associations: [
      ...(base.trade_associations ?? []),
      ...(overlay.trade_associations ?? []),
    ],
    industry_tags: [...(base.industry_tags ?? []), ...(overlay.industry_tags ?? [])],
    agencies: [...(base.agencies ?? []), ...(overlay.agencies ?? [])],
    committees: [...(base.committees ?? []), ...(overlay.committees ?? [])],
    priority_bills: [...(base.priority_bills ?? []), ...(overlay.priority_bills ?? [])],
    amendments: [...(base.amendments ?? []), ...(overlay.amendments ?? [])],
    regulations: [...(base.regulations ?? []), ...(overlay.regulations ?? [])],
    programs: [...(base.programs ?? []), ...(overlay.programs ?? [])],
    budget_accounts: [
      ...(base.budget_accounts ?? []),
      ...(overlay.budget_accounts ?? []),
    ],
    geographies: [...(base.geographies ?? []), ...(overlay.geographies ?? [])],
    facilities: [...(base.facilities ?? []), ...(overlay.facilities ?? [])],
    key_people: [...(base.key_people ?? []), ...(overlay.key_people ?? [])],
    care_about: overlay.care_about ?? base.care_about ?? "",
    ignore_unless_directly_mentioned:
      overlay.ignore_unless_directly_mentioned ??
      base.ignore_unless_directly_mentioned ??
      "",
    confidential_internal_notes:
      overlay.confidential_internal_notes ??
      base.confidential_internal_notes ??
      "",
  });
  const dedupe = (values: string[]) => Array.from(new Set(values.filter(Boolean)));
  return {
    ...merged,
    aliases: dedupe(merged.aliases),
    tickers: dedupe(merged.tickers),
    subsidiaries: dedupe(merged.subsidiaries),
    products: dedupe(merged.products),
    competitors: dedupe(merged.competitors),
    trade_associations: dedupe(merged.trade_associations),
    industry_tags: dedupe(merged.industry_tags),
    agencies: dedupe(merged.agencies),
    committees: dedupe(merged.committees),
    priority_bills: dedupe(merged.priority_bills),
    amendments: dedupe(merged.amendments),
    regulations: dedupe(merged.regulations),
    programs: dedupe(merged.programs),
    budget_accounts: dedupe(merged.budget_accounts),
    geographies: dedupe(merged.geographies),
    facilities: dedupe(merged.facilities),
    key_people: dedupe(merged.key_people),
  };
}

function defaultWatchItems(
  hearingJobId: string,
  context: HearingClientContext,
): HearingWatchItemDraft[] {
  const items: HearingWatchItemDraft[] = [];
  for (const label of [
    ...context.priority_bills,
    ...context.amendments,
    ...context.regulations,
  ]) {
    items.push({
      type: "bill",
      label,
      aliases: [],
      match_mode: "hybrid",
      importance: "high",
      negative_filters: [],
    });
  }
  for (const label of [
    ...context.aliases,
    ...context.subsidiaries,
    ...context.products,
    ...context.competitors,
    ...context.trade_associations,
  ]) {
    items.push({
      type: "organization",
      label,
      aliases: [],
      match_mode: "hybrid",
      importance: "medium",
      negative_filters: [],
    });
  }
  for (const label of [...context.agencies, ...context.programs]) {
    items.push({
      type: "agency",
      label,
      aliases: [],
      match_mode: "hybrid",
      importance: "medium",
      negative_filters: [],
    });
  }
  return items.map((item) => HearingWatchItemDraftSchema.parse({ ...item, hearingJobId }));
}

export function listHearingIntelligenceJobs() {
  return listHearingJobs();
}

export function getHearingIntelligenceWorkspace(hearingJobId: string) {
  const workspace = getHearingWorkspace(hearingJobId);
  if (!workspace) throw new Error("Hearing job not found");
  return workspace;
}

export async function createHearingIntelligenceJob(input: HearingCreateInput) {
  const clientId = input.client_id?.trim() ?? "";
  const client = clientId ? getClient(clientId) : null;
  if (clientId && !client) throw new Error("Client not found");
  const derivedContext = client ? contextFromClientKnowledge(client.knowledge) : {};
  const clientContext = mergeContext(derivedContext, input.client_context ?? {});
  const job = createHearingJob({
    ...input,
    client_id: client?.id ?? clientId,
    client_name: input.client_name ?? client?.name ?? "",
    client_context: clientContext,
    watch_items:
      input.watch_items && input.watch_items.length > 0
        ? input.watch_items
        : defaultWatchItems("", clientContext),
  });
  return job;
}

export async function resolveHearingIntelligenceJob(hearingJobId: string) {
  const job = getHearingJob(hearingJobId);
  if (!job) throw new Error("Hearing job not found");
  updateHearingJobStatus(hearingJobId, "resolving");
  try {
    const metadata = await resolveHearingSource(job.source_url);
    return applyResolvedMetadata(hearingJobId, metadata);
  } catch (err) {
    updateHearingJobStatus(
      hearingJobId,
      "failed",
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
}

function youtubeSourceFromMetadata(job: HearingJob): HearingYoutubeSource | null {
  const source = job.metadata.youtube_source;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const record = source as Partial<HearingYoutubeSource>;
  return typeof record.url === "string" && typeof record.video_id === "string"
    ? (record as HearingYoutubeSource)
    : null;
}

async function probeAndStoreYoutubeSource(
  hearingJobId: string,
  rawUrl: string,
  options: { requireProbe: boolean },
): Promise<HearingYoutubeSource> {
  const normalized = normalizeYoutubeVideoInput(rawUrl);
  try {
    const probed = await probeYoutubeSource(rawUrl);
    updateHearingMetadata(hearingJobId, { youtube_source: probed });
    return probed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const source = normalized
      ? {
          ...normalized,
          probe_error: message,
        }
      : null;
    if (source) updateHearingMetadata(hearingJobId, { youtube_source: source });
    if (options.requireProbe) {
      throw new Error(`Could not validate YouTube video: ${message}`);
    }
    if (!source) {
      throw new Error("Capture requires a YouTube video URL or video ID.");
    }
    return source;
  }
}

export async function resolveHearingIntelligenceStream(hearingJobId: string) {
  const job = await resolveHearingIntelligenceJob(hearingJobId);
  const metadataSource = youtubeSourceFromMetadata(job);
  const streamUrl = job.stream_url || metadataSource?.url || "";
  if (!streamUrl) {
    updateHearingCaptureState(hearingJobId, {
      status: "metadata_resolved",
      capture_status: "idle",
      transcription_status: "idle",
      capture_error:
        "No usable YouTube video was found. Paste a YouTube video URL or video ID in Override YouTube URL or Video ID.",
    });
    throw new Error("No usable YouTube video was found on this hearing webpage.");
  }
  const youtubeSource = await probeAndStoreYoutubeSource(hearingJobId, streamUrl, {
    requireProbe: false,
  });
  return updateHearingCaptureState(hearingJobId, {
    status: "stream_resolved",
    stream_url: youtubeSource.url,
    stream_provider: "youtube",
    stream_confidence: job.stream_confidence || 0.99,
    capture_status: "resolved",
    transcription_status: "idle",
    capture_error: youtubeSource.probe_error,
  });
}

export async function startHearingIntelligenceCapture(args: {
  hearingJobId: string;
  streamUrl?: string;
}) {
  let job = getHearingJob(args.hearingJobId);
  if (!job) throw new Error("Hearing job not found");
  if (!job.stream_url && !args.streamUrl) {
    job = await resolveHearingIntelligenceStream(args.hearingJobId);
  }
  const rawUrl = args.streamUrl?.trim() || job.stream_url;
  const youtubeSource = await probeAndStoreYoutubeSource(args.hearingJobId, rawUrl, {
    requireProbe: true,
  });
  if (youtubeSource.live_status === "scheduled") {
    updateHearingCaptureState(args.hearingJobId, {
      stream_url: youtubeSource.url,
      stream_provider: "youtube",
      capture_status: "resolved",
      transcription_status: "idle",
      capture_error: "This YouTube video is scheduled but not live yet.",
    });
    throw new Error("This YouTube video is scheduled but not live yet.");
  }
  updateHearingCaptureState(args.hearingJobId, {
    stream_url: youtubeSource.url,
    stream_provider: "youtube",
    stream_confidence: 0.99,
    capture_status: "resolved",
    transcription_status: "idle",
    capture_error: "",
  });
  return startLiveHearingCapture({
    hearingJobId: args.hearingJobId,
    streamUrl: youtubeSource.url,
  });
}

export async function stopHearingIntelligenceCapture(hearingJobId: string) {
  return stopLiveHearingCapture(hearingJobId);
}

export function getHearingIntelligenceCaptureStatus(hearingJobId: string) {
  return getLiveHearingCaptureStatus(hearingJobId);
}

export async function importHearingTranscript(args: {
  hearingJobId: string;
  text: string;
  filename?: string;
  source?: TranscriptSource;
}): Promise<HearingTranscriptSegment[]> {
  const job = getHearingJob(args.hearingJobId);
  if (!job) throw new Error("Hearing job not found");
  updateHearingJobStatus(args.hearingJobId, "transcribing");
  const segments = parseTranscriptText({
    hearingJobId: args.hearingJobId,
    text: args.text,
    filename: args.filename,
    source: args.source ?? "manual",
  });
  if (segments.length === 0) {
    updateHearingJobStatus(args.hearingJobId, "failed", "No transcript segments could be parsed.");
    throw new Error("No transcript segments could be parsed.");
  }
  return replaceTranscriptSegments(args.hearingJobId, segments);
}

export async function fetchAndImportHearingTranscript(args: {
  hearingJobId: string;
  transcriptUrl: string;
}) {
  const job = getHearingJob(args.hearingJobId);
  if (!job) throw new Error("Hearing job not found");
  updateHearingJobStatus(args.hearingJobId, "transcribing");
  const segments = await fetchTranscriptFromUrl({
    hearingJobId: args.hearingJobId,
    url: args.transcriptUrl,
  });
  if (segments.length === 0) {
    updateHearingJobStatus(args.hearingJobId, "failed", "No transcript segments could be parsed.");
    throw new Error("No transcript segments could be parsed.");
  }
  return replaceTranscriptSegments(args.hearingJobId, segments);
}

export async function transcribeAndImportHearingMedia(args: {
  hearingJobId: string;
  mediaUrl: string;
}) {
  const job = getHearingJob(args.hearingJobId);
  if (!job) throw new Error("Hearing job not found");
  updateHearingJobStatus(args.hearingJobId, "transcribing");
  const segments = await transcribeMediaFromUrl({
    hearingJobId: args.hearingJobId,
    mediaUrl: args.mediaUrl,
  });
  if (segments.length === 0) {
    updateHearingJobStatus(args.hearingJobId, "failed", "No transcript segments could be parsed.");
    throw new Error("No transcript segments could be parsed.");
  }
  return replaceTranscriptSegments(args.hearingJobId, segments);
}

export function saveHearingWatchItems(args: {
  hearingJobId: string;
  watchItems: HearingWatchItemDraft[];
}) {
  const job = getHearingJob(args.hearingJobId);
  if (!job) throw new Error("Hearing job not found");
  return replaceWatchItems(args.hearingJobId, args.watchItems);
}

export function runHearingWatchlist(hearingJobId: string) {
  const workspace = getHearingIntelligenceWorkspace(hearingJobId);
  const hits = detectWatchlistHits({
    hearingJobId,
    watchItems: workspace.watch_items,
    segments: workspace.transcript_segments,
    clientContext: workspace.job.client_context,
  });
  return replaceWatchHits(hearingJobId, hits);
}

async function congressionalContextForWorkspace(
  workspace: ReturnType<typeof getHearingIntelligenceWorkspace>,
): Promise<CongressionalContext> {
  return getCongressionalContext({
    hearingTitle: workspace.job.hearing_title,
    committee: workspace.job.committee,
    sourceUrl: workspace.job.source_url,
    transcriptText: transcriptText(workspace.transcript_segments).slice(0, 80_000),
    billReferences: [
      ...((workspace.job.metadata.bill_references as string[] | undefined) ?? []),
      ...workspace.watch_items
        .filter((item) => item.type === "bill")
        .map((item) => item.label),
    ],
  });
}

export async function generateHearingIntelligenceOutput(args: {
  hearingJobId: string;
  outputType: HearingOutputType;
  reviewerInstructions?: string;
  useAi?: boolean;
}) {
  const outputType = HearingOutputTypeEnum.parse(args.outputType);
  const workspace = getHearingIntelligenceWorkspace(args.hearingJobId);
  if (
    workspace.transcript_segments.length === 0 &&
    outputType !== "pre_hearing_brief"
  ) {
    throw new Error("Import or fetch a transcript before generating this output.");
  }
  updateHearingJobStatus(args.hearingJobId, "analyzing");
  const context = await congressionalContextForWorkspace(workspace);
  return generateHearingOutput({
    job: workspace.job,
    outputType,
    segments: workspace.transcript_segments,
    watchItems: workspace.watch_items,
    watchHits: workspace.watch_hits,
    congressionalContext: context,
    reviewerInstructions: args.reviewerInstructions,
    useAi: args.useAi,
  });
}

export async function runHearingIntelligenceJob(args: {
  hearingJobId: string;
  outputType?: HearingOutputType;
  reviewerInstructions?: string;
  useAi?: boolean;
}) {
  let workspace = getHearingIntelligenceWorkspace(args.hearingJobId);
  if (workspace.job.status === "created" || !workspace.job.hearing_title) {
    await resolveHearingIntelligenceJob(args.hearingJobId);
    workspace = getHearingIntelligenceWorkspace(args.hearingJobId);
  }
  const transcriptUrl =
    typeof workspace.job.metadata.transcript_url === "string"
      ? workspace.job.metadata.transcript_url
      : "";
  if (workspace.transcript_segments.length === 0 && transcriptUrl) {
    await fetchAndImportHearingTranscript({
      hearingJobId: args.hearingJobId,
      transcriptUrl,
    });
    workspace = getHearingIntelligenceWorkspace(args.hearingJobId);
  }
  if (workspace.transcript_segments.length > 0) {
    runHearingWatchlist(args.hearingJobId);
  }
  const fresh = getHearingIntelligenceWorkspace(args.hearingJobId);
  const outputType =
    args.outputType ??
    (fresh.job.mode === "watchlist" ? "targeted_recap" : fresh.job.mode === "pre_hearing" ? "pre_hearing_brief" : "full_memo");
  return generateHearingIntelligenceOutput({
    hearingJobId: args.hearingJobId,
    outputType,
    reviewerInstructions: args.reviewerInstructions,
    useAi: args.useAi,
  });
}

export async function generateFinalHearingIntelligenceBrief(args: {
  hearingJobId: string;
  outputType?: HearingOutputType;
  reviewerInstructions?: string;
  useAi?: boolean;
}) {
  let workspace = getHearingIntelligenceWorkspace(args.hearingJobId);
  if (workspace.job.capture_status === "running" || workspace.job.capture_status === "starting") {
    await stopHearingIntelligenceCapture(args.hearingJobId);
    workspace = getHearingIntelligenceWorkspace(args.hearingJobId);
  }
  if (workspace.transcript_segments.length === 0) {
    throw new Error("Stop capture after at least one transcript chunk before generating a final brief.");
  }
  runHearingWatchlist(args.hearingJobId);
  const fresh = getHearingIntelligenceWorkspace(args.hearingJobId);
  const outputType =
    args.outputType ??
    (fresh.job.mode === "watchlist" ? "targeted_recap" : "full_memo");
  return generateHearingIntelligenceOutput({
    hearingJobId: args.hearingJobId,
    outputType,
    reviewerInstructions: args.reviewerInstructions,
    useAi: args.useAi,
  });
}

export function updateHearingReview(args: {
  segmentId?: string;
  segmentReviewStatus?: ReviewStatus;
  speakerLabel?: string;
  hitId?: string;
  hitStatus?: WatchHitStatus;
  outputId?: string;
  outputMarkdown?: string;
  outputReviewStatus?: ReviewStatus;
  claimId?: string;
  claimVerificationStatus?: VerificationStatus;
}) {
  const results: Record<string, unknown> = {};
  if (args.segmentId && args.segmentReviewStatus) {
    results.segment = updateTranscriptSegmentReview(
      args.segmentId,
      args.segmentReviewStatus,
      args.speakerLabel,
    );
  }
  if (args.hitId && args.hitStatus) {
    results.hit = updateWatchHitStatus(args.hitId, args.hitStatus);
  }
  if (args.outputId && args.outputMarkdown !== undefined && args.outputReviewStatus) {
    results.output = updateHearingOutput(
      args.outputId,
      args.outputMarkdown,
      args.outputReviewStatus,
    );
  }
  if (args.claimId && args.claimVerificationStatus) {
    results.claim = updateHearingClaimStatus(
      args.claimId,
      args.claimVerificationStatus,
    );
  }
  return results;
}

export function addHearingReviewComment(args: {
  hearingJobId: string;
  targetType: "job" | "segment" | "hit" | "claim" | "output";
  targetId: string;
  comment: string;
}) {
  return addHearingComment(
    args.hearingJobId,
    args.targetType,
    args.targetId,
    args.comment,
  );
}

export async function exportHearingIntelligence(args: {
  hearingJobId: string;
  format: HearingExportFormat;
  outputId?: string;
}) {
  const format = HearingExportFormatEnum.parse(args.format);
  const workspace = getHearingIntelligenceWorkspace(args.hearingJobId);
  return exportHearingWorkspace({
    workspace,
    format,
    outputId: args.outputId,
  });
}
