import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { getUserDataPath, settings } from "./config";
import { requireMediaTool } from "./media-tools";
import { normalizeYoutubeVideoInput } from "./youtube-source";
import {
  appendTranscriptSegments,
  getHearingJob,
  getHearingWorkspace,
  replaceWatchHits,
  updateHearingCaptureState,
} from "./hearing-store";
import { transcribeLiveAudioChunk } from "./hearing-live-transcription";
import { detectWatchlistHits } from "./hearing-watchlist";
import type { HearingWorkspace } from "./hearing-models";

const DEFAULT_CHUNK_SECONDS = 60;

interface CaptureSession {
  hearingJobId: string;
  streamUrl: string;
  captureDir: string;
  chunkSeconds: number;
  startedAt: string;
  ytdlp: ChildProcessWithoutNullStreams | null;
  ffmpeg: ChildProcessWithoutNullStreams;
  timer: NodeJS.Timeout;
  processed: Set<string>;
  processing: Set<string>;
  scanning: boolean;
  stopping: boolean;
  finalizing: boolean;
}

const sessions = new Map<string, CaptureSession>();

function chunkSeconds(): number {
  const parsed = Number(process.env.HEARING_LIVE_CHUNK_SECONDS ?? "");
  return Number.isFinite(parsed) && parsed >= 15 ? Math.round(parsed) : DEFAULT_CHUNK_SECONDS;
}

function captureRoot(): string {
  return path.join(getUserDataPath(), "hearing-capture");
}

function safeStamp(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "-");
}

function chunkIndex(filename: string): number {
  const match = filename.match(/chunk-(\d+)\.wav$/i);
  return match ? Number(match[1]) : 0;
}

async function listReadyChunks(
  session: CaptureSession,
  includeRecent: boolean,
): Promise<string[]> {
  const entries = await fs.readdir(session.captureDir, { withFileTypes: true });
  const now = Date.now();
  const ready: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^chunk-\d+\.wav$/i.test(entry.name)) continue;
    const filePath = path.join(session.captureDir, entry.name);
    if (session.processed.has(filePath) || session.processing.has(filePath)) continue;
    const stat = await fs.stat(filePath);
    if (stat.size < 1024) continue;
    if (!includeRecent && now - stat.mtimeMs < 5000) continue;
    ready.push(filePath);
  }
  return ready.sort((a, b) => chunkIndex(path.basename(a)) - chunkIndex(path.basename(b)));
}

function refreshWatchlist(hearingJobId: string): void {
  const workspace = getHearingWorkspace(hearingJobId);
  if (!workspace) return;
  const hits = detectWatchlistHits({
    hearingJobId,
    watchItems: workspace.watch_items,
    segments: workspace.transcript_segments,
    clientContext: workspace.job.client_context,
  });
  replaceWatchHits(hearingJobId, hits);
}

async function processClosedChunks(
  session: CaptureSession,
  includeRecent = false,
): Promise<void> {
  if (session.scanning) return;
  session.scanning = true;
  try {
    const chunks = await listReadyChunks(session, includeRecent);
    for (const audioPath of chunks) {
      session.processing.add(audioPath);
      try {
        updateHearingCaptureState(session.hearingJobId, {
          transcription_status: "transcribing",
          capture_error: "",
        });
        const offsetMs = chunkIndex(path.basename(audioPath)) * session.chunkSeconds * 1000;
        const segments = await transcribeLiveAudioChunk({
          hearingJobId: session.hearingJobId,
          audioPath,
          offsetMs,
        });
        if (segments.length > 0) {
          appendTranscriptSegments(session.hearingJobId, segments);
          refreshWatchlist(session.hearingJobId);
        }
        session.processed.add(audioPath);
        updateHearingCaptureState(session.hearingJobId, {
          status: session.stopping ? "finalizing" : "capturing",
          audio_chunk_count: session.processed.size,
          transcription_status: session.stopping ? "complete" : "waiting",
        });
        await fs.unlink(audioPath).catch(() => {});
      } catch (err) {
        session.processed.add(audioPath);
        updateHearingCaptureState(session.hearingJobId, {
          audio_chunk_count: session.processed.size,
          transcription_status: "failed",
          capture_error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        session.processing.delete(audioPath);
      }
    }
  } finally {
    session.scanning = false;
  }
}

async function cleanupCaptureDir(session: CaptureSession): Promise<void> {
  await fs.rm(session.captureDir, { recursive: true, force: true }).catch(() => {});
}

async function finalizeCompletedSession(session: CaptureSession): Promise<void> {
  if (session.finalizing) return;
  session.finalizing = true;
  session.stopping = true;
  clearInterval(session.timer);
  const stoppedAt = new Date().toISOString();
  updateHearingCaptureState(session.hearingJobId, {
    status: "finalizing",
    capture_status: "stopping",
    capture_stopped_at: stoppedAt,
  });
  await processClosedChunks(session, true);
  sessions.delete(session.hearingJobId);
  await cleanupCaptureDir(session);
  refreshWatchlist(session.hearingJobId);
  updateHearingCaptureState(session.hearingJobId, {
    status: "ready_for_review",
    capture_status: "finalized",
    capture_stopped_at: stoppedAt,
    transcription_status: "complete",
  });
}

function wireProcessFailure(session: CaptureSession): void {
  let stderr = "";
  const exited = {
    ytdlp: session.ytdlp === null,
    ffmpeg: false,
  };
  const capture = (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString("utf-8")}`.slice(-1000);
  };
  session.ytdlp?.stderr.on("data", capture);
  session.ffmpeg.stderr.on("data", capture);
  const maybeFinalize = () => {
    if (session.stopping) return;
    if (exited.ytdlp && exited.ffmpeg) {
      void finalizeCompletedSession(session).catch((err) => {
        updateHearingCaptureState(session.hearingJobId, {
          status: "failed",
          capture_status: "failed",
          transcription_status: "failed",
          capture_error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  };
  const onExit = (name: "yt-dlp" | "ffmpeg") => (code: number | null) => {
    if (session.stopping) return;
    if (code === 0) {
      exited[name === "yt-dlp" ? "ytdlp" : "ffmpeg"] = true;
      maybeFinalize();
      return;
    }
    updateHearingCaptureState(session.hearingJobId, {
      status: "failed",
      capture_status: "failed",
      transcription_status: "failed",
      capture_error: `${name} exited${code === null ? "" : ` with code ${code}`}${stderr ? `: ${stderr}` : ""}`,
    });
    clearInterval(session.timer);
    sessions.delete(session.hearingJobId);
    void cleanupCaptureDir(session);
  };
  session.ytdlp?.on("exit", onExit("yt-dlp"));
  session.ffmpeg.on("exit", onExit("ffmpeg"));
}

async function spawnCapturePipeline(args: {
  streamUrl: string;
  outputPattern: string;
  chunkSeconds: number;
}): Promise<Pick<CaptureSession, "ytdlp" | "ffmpeg">> {
  const ffmpegPath = await requireMediaTool("ffmpeg");
  const ytDlpPath = await requireMediaTool("yt-dlp");

  const segmentArgs = [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-i",
    "pipe:0",
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-f",
    "segment",
    "-segment_time",
    String(args.chunkSeconds),
    "-reset_timestamps",
    "1",
    args.outputPattern,
  ];

  const ytdlp = spawn(ytDlpPath, [
    "-f",
    "ba/bestaudio/best",
    "--no-playlist",
    "-o",
    "-",
    args.streamUrl,
  ]);
  const ffmpeg = spawn(ffmpegPath, segmentArgs);
  ytdlp.stdout.pipe(ffmpeg.stdin);
  return { ytdlp, ffmpeg };
}

export async function startLiveHearingCapture(args: {
  hearingJobId: string;
  streamUrl?: string;
}): Promise<HearingWorkspace> {
  if (!settings.openai_api_key && !process.env.OPENAI_API_KEY) {
    throw new Error("OpenAI API key is required for live hearing transcription.");
  }
  if (sessions.has(args.hearingJobId)) {
    throw new Error("Live hearing capture is already running for this job.");
  }
  const job = getHearingJob(args.hearingJobId);
  if (!job) throw new Error("Hearing job not found");
  const youtubeSource = normalizeYoutubeVideoInput(args.streamUrl ?? job.stream_url);
  if (!youtubeSource) {
    throw new Error("Resolve a YouTube video before starting capture.");
  }
  const streamUrl = youtubeSource.url;

  const startedAt = new Date().toISOString();
  const seconds = chunkSeconds();
  const captureDir = path.join(
    captureRoot(),
    args.hearingJobId,
    safeStamp(startedAt),
  );
  await fs.mkdir(captureDir, { recursive: true });
  updateHearingCaptureState(args.hearingJobId, {
    status: "capturing",
    stream_url: streamUrl,
    stream_provider: "youtube",
    capture_status: "starting",
    capture_started_at: startedAt,
    capture_stopped_at: null,
    audio_chunk_count: 0,
    transcription_status: "waiting",
    capture_error: "",
  });

  const pipeline = await spawnCapturePipeline({
    streamUrl,
    outputPattern: path.join(captureDir, "chunk-%06d.wav"),
    chunkSeconds: seconds,
  });
  const session: CaptureSession = {
    hearingJobId: args.hearingJobId,
    streamUrl,
    captureDir,
    chunkSeconds: seconds,
    startedAt,
    ytdlp: pipeline.ytdlp,
    ffmpeg: pipeline.ffmpeg,
    timer: setInterval(() => {
      void processClosedChunks(session);
    }, Math.max(5000, Math.min(seconds * 1000, 15000))),
    processed: new Set(),
    processing: new Set(),
    scanning: false,
    stopping: false,
    finalizing: false,
  };
  sessions.set(args.hearingJobId, session);
  wireProcessFailure(session);
  updateHearingCaptureState(args.hearingJobId, {
    status: "capturing",
    capture_status: "running",
  });
  return getLiveHearingCaptureStatus(args.hearingJobId);
}

async function stopProcess(child: ChildProcessWithoutNullStreams | null): Promise<void> {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2500);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

export async function stopLiveHearingCapture(hearingJobId: string): Promise<HearingWorkspace> {
  const session = sessions.get(hearingJobId);
  const stoppedAt = new Date().toISOString();
  updateHearingCaptureState(hearingJobId, {
    status: "finalizing",
    capture_status: "stopping",
    capture_stopped_at: stoppedAt,
  });

  if (session) {
    session.stopping = true;
    session.finalizing = true;
    clearInterval(session.timer);
    await Promise.all([stopProcess(session.ytdlp), stopProcess(session.ffmpeg)]);
    await processClosedChunks(session, true);
    sessions.delete(hearingJobId);
    await cleanupCaptureDir(session);
  }

  refreshWatchlist(hearingJobId);
  updateHearingCaptureState(hearingJobId, {
    status: "ready_for_review",
    capture_status: "finalized",
    capture_stopped_at: stoppedAt,
    transcription_status: "complete",
  });
  return getLiveHearingCaptureStatus(hearingJobId);
}

export function getLiveHearingCaptureStatus(hearingJobId: string): HearingWorkspace {
  const workspace = getHearingWorkspace(hearingJobId);
  if (!workspace) throw new Error("Hearing job not found");
  return workspace;
}
