import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { getUserDataPath } from "./config";
import {
  isYoutubeHost,
  mapYtDlpLiveStatus,
  normalizeYoutubeVideoInput,
  type YoutubeSourceMetadata,
} from "./youtube-source";

const execFileAsync = promisify(execFile);
const TOOL_TIMEOUT_MS = 8000;

export type MediaToolName = "yt-dlp" | "ffmpeg";
export type MediaToolSource = "resources" | "userData" | "project" | "package" | "path";

export interface MediaToolStatus {
  name: MediaToolName;
  available: boolean;
  path: string;
  source: MediaToolSource | "";
  version: string;
  error: string;
}

export interface MediaToolStatuses {
  yt_dlp_available: boolean;
  yt_dlp_path: string;
  yt_dlp_source: MediaToolSource | "";
  yt_dlp_version: string;
  yt_dlp_error: string;
  ffmpeg_available: boolean;
  ffmpeg_path: string;
  ffmpeg_source: MediaToolSource | "";
  ffmpeg_version: string;
  ffmpeg_error: string;
}

interface Candidate {
  path: string;
  source: MediaToolSource;
}

interface YtDlpMetadata {
  id?: unknown;
  webpage_url?: unknown;
  original_url?: unknown;
  title?: unknown;
  channel?: unknown;
  uploader?: unknown;
  duration?: unknown;
  live_status?: unknown;
  entries?: unknown;
}

interface YtDlpEntryMetadata {
  id?: unknown;
  webpage_url?: unknown;
  original_url?: unknown;
  title?: unknown;
  channel?: unknown;
  uploader?: unknown;
  duration?: unknown;
  live_status?: unknown;
}

function executableName(name: MediaToolName): string {
  if (process.platform !== "win32") return name;
  return name === "yt-dlp" ? "yt-dlp.exe" : "ffmpeg.exe";
}

function projectRoot(): string {
  return process.cwd();
}

function userDataToolPath(name: MediaToolName): string | null {
  try {
    return path.join(getUserDataPath(), "media-tools", executableName(name));
  } catch {
    return null;
  }
}

function packageToolPath(name: MediaToolName): string | null {
  if (name === "yt-dlp") {
    return path.join(projectRoot(), "node_modules", "yt-dlp-exec", "bin", executableName(name));
  }
  return path.join(projectRoot(), "node_modules", "ffmpeg-static", executableName(name));
}

function candidatePaths(name: MediaToolName): Candidate[] {
  const bin = executableName(name);
  const candidates: Candidate[] = [];
  if (process.resourcesPath) {
    candidates.push({
      path: path.join(process.resourcesPath, "media-tools", bin),
      source: "resources",
    });
  }
  const userPath = userDataToolPath(name);
  if (userPath) candidates.push({ path: userPath, source: "userData" });
  candidates.push(
    { path: path.join(projectRoot(), "media-tools", bin), source: "project" },
    { path: packageToolPath(name) ?? "", source: "package" },
    { path: bin, source: "path" },
  );
  return candidates.filter((candidate) => Boolean(candidate.path));
}

function exists(candidate: Candidate): boolean {
  if (candidate.source === "path") return true;
  try {
    fs.accessSync(
      candidate.path,
      process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

async function versionFor(name: MediaToolName, commandPath: string): Promise<string> {
  const versionArgs = name === "ffmpeg" ? ["-version"] : ["--version"];
  const { stdout } = await execFileAsync(commandPath, versionArgs, {
    timeout: TOOL_TIMEOUT_MS,
    maxBuffer: 1024 * 128,
  });
  const firstLine = stdout.trim().split(/\r?\n/)[0] ?? "";
  if (name === "ffmpeg") {
    return firstLine.match(/ffmpeg version\s+([^\s]+)/i)?.[1] ?? firstLine;
  }
  return firstLine;
}

export async function resolveMediaTool(name: MediaToolName): Promise<MediaToolStatus> {
  let lastError = "";
  for (const candidate of candidatePaths(name)) {
    if (!exists(candidate)) continue;
    try {
      const version = await versionFor(name, candidate.path);
      return {
        name,
        available: true,
        path: candidate.path,
        source: candidate.source,
        version,
        error: "",
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    name,
    available: false,
    path: "",
    source: "",
    version: "",
    error: lastError || `${name} was not found.`,
  };
}

export async function getMediaToolStatuses(): Promise<MediaToolStatuses> {
  const [ytDlp, ffmpeg] = await Promise.all([
    resolveMediaTool("yt-dlp"),
    resolveMediaTool("ffmpeg"),
  ]);
  return {
    yt_dlp_available: ytDlp.available,
    yt_dlp_path: ytDlp.path,
    yt_dlp_source: ytDlp.source,
    yt_dlp_version: ytDlp.version,
    yt_dlp_error: ytDlp.error,
    ffmpeg_available: ffmpeg.available,
    ffmpeg_path: ffmpeg.path,
    ffmpeg_source: ffmpeg.source,
    ffmpeg_version: ffmpeg.version,
    ffmpeg_error: ffmpeg.error,
  };
}

export async function requireMediaTool(name: MediaToolName): Promise<string> {
  const tool = await resolveMediaTool(name);
  if (!tool.available) {
    throw new Error(
      name === "yt-dlp"
        ? `YouTube extractor is not available: ${tool.error}`
        : `ffmpeg is not available: ${tool.error}`,
    );
  }
  return tool.path;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readDuration(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function youtubeProbeTarget(rawInput: string): { target: string; resolvedFrom: string } {
  const normalized = normalizeYoutubeVideoInput(rawInput);
  if (normalized) {
    return { target: normalized.url, resolvedFrom: normalized.resolved_from };
  }

  try {
    const parsed = new URL(rawInput);
    if (isYoutubeHost(parsed.hostname)) {
      return { target: parsed.toString(), resolvedFrom: rawInput.trim() };
    }
  } catch {
    // Fall through to the consistent validation error below.
  }

  throw new Error("Provide a YouTube video URL or video ID.");
}

function concreteEntry(parsed: YtDlpMetadata): YtDlpMetadata | YtDlpEntryMetadata {
  if (!Array.isArray(parsed.entries)) return parsed;
  if (parsed.entries.length !== 1) {
    throw new Error("YouTube URL resolved to a playlist or channel, not one video.");
  }
  const [entry] = parsed.entries;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error("YouTube URL did not resolve to a concrete video.");
  }
  return entry as YtDlpEntryMetadata;
}

export async function probeYoutubeSource(url: string): Promise<YoutubeSourceMetadata> {
  const probe = youtubeProbeTarget(url);
  const ytDlpPath = await requireMediaTool("yt-dlp");
  const { stdout } = await execFileAsync(
    ytDlpPath,
    ["--dump-single-json", "--no-playlist", "--skip-download", probe.target],
    { timeout: 30_000, maxBuffer: 1024 * 1024 * 8 },
  );
  const parsed = JSON.parse(stdout) as YtDlpMetadata;
  const metadata = concreteEntry(parsed);
  const probedId = readString(metadata.id);
  const probed = normalizeYoutubeVideoInput(
    readString(metadata.webpage_url) || readString(metadata.original_url) || probedId,
  );
  if (!probed) {
    throw new Error("YouTube probe did not return a concrete video ID.");
  }
  return {
    ...probed,
    title: readString(metadata.title),
    channel: readString(metadata.channel) || readString(metadata.uploader),
    duration_seconds: readDuration(metadata.duration),
    live_status: mapYtDlpLiveStatus(metadata.live_status, metadata.duration),
    resolved_from: probe.resolvedFrom,
    validated_at: new Date().toISOString(),
    probe_error: "",
  };
}
