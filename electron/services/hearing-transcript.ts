import { v4 as uuidv4 } from "uuid";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  HearingTranscriptSegmentSchema,
  type HearingTranscriptSegment,
  type SpeakerType,
  type TranscriptSource,
} from "./hearing-models";
import { requireMediaTool } from "./media-tools";

const execFileAsync = promisify(execFile);

function parseTimecode(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  const parts = trimmed.split(":").map((part) => part.trim());
  if (parts.some((part) => !part)) return null;
  let seconds = 0;
  if (parts.length === 3) {
    seconds =
      Number(parts[0]) * 3600 +
      Number(parts[1]) * 60 +
      Number(parts[2]);
  } else if (parts.length === 2) {
    seconds = Number(parts[0]) * 60 + Number(parts[1]);
  } else if (parts.length === 1) {
    seconds = Number(parts[0]);
  } else {
    return null;
  }
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round(seconds * 1000);
}

function formatSpeaker(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  return value || "Unknown Speaker";
}

function inferSpeakerType(speaker: string): SpeakerType {
  if (/chair|chairman|chairwoman|ranking member/i.test(speaker)) return "chair";
  if (/sen\.|senator|rep\.|representative|delegate/i.test(speaker)) return "member";
  if (/secretary|administrator|director|president|ceo|witness/i.test(speaker)) {
    return "witness";
  }
  return "unknown";
}

function segment(
  hearingJobId: string,
  startMs: number,
  endMs: number,
  speaker: string,
  text: string,
  source: TranscriptSource,
): HearingTranscriptSegment {
  return HearingTranscriptSegmentSchema.parse({
    segmentId: uuidv4(),
    hearingJobId,
    startMs,
    endMs: Math.max(endMs, startMs + 1000),
    speakerLabel: formatSpeaker(speaker),
    speakerType: inferSpeakerType(speaker),
    text: text.trim(),
    asrConfidence: source === "manual" || source === "official_transcript" ? 0.98 : 0.82,
    speakerConfidence: speaker && !/unknown/i.test(speaker) ? 0.78 : 0.35,
    source,
    reviewStatus: speaker && !/unknown/i.test(speaker) ? "unreviewed" : "needs_review",
  });
}

function parseSrt(hearingJobId: string, text: string, source: TranscriptSource): HearingTranscriptSegment[] {
  const blocks = text
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const segments: HearingTranscriptSegment[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timingIdx = lines.findIndex((line) => /-->|–>|—>/.test(line));
    if (timingIdx === -1) continue;
    const timing = lines[timingIdx].split(/-->|–>|—>/).map((part) => part.trim());
    const startMs = parseTimecode(timing[0]);
    const endMs = parseTimecode(timing[1] ?? "");
    if (startMs === null || endMs === null) continue;
    const body = lines.slice(timingIdx + 1).join(" ").replace(/\s+/g, " ").trim();
    if (!body) continue;
    const speakerMatch = body.match(/^([A-Z][A-Za-z .,'’()-]{1,80}):\s+(.+)$/);
    segments.push(
      segment(
        hearingJobId,
        startMs,
        endMs,
        speakerMatch?.[1] ?? "Unknown Speaker",
        speakerMatch?.[2] ?? body,
        source,
      ),
    );
  }
  return segments;
}

function parseVtt(hearingJobId: string, text: string, source: TranscriptSource): HearingTranscriptSegment[] {
  const withoutHeader = text.replace(/^\uFEFF?WEBVTT[^\n]*\n/i, "");
  return parseSrt(hearingJobId, withoutHeader, source);
}

function parseTimestampedLines(
  hearingJobId: string,
  text: string,
  source: TranscriptSource,
): HearingTranscriptSegment[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const parsed: Array<{ startMs: number; speaker: string; text: string }> = [];
  const pattern =
    /^\s*(?:\[?(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\]?)\s*(?:(.+?):\s*)?(.+?)\s*$/;
  for (const line of lines) {
    const match = line.match(pattern);
    if (!match) continue;
    const startMs = parseTimecode(match[1]);
    if (startMs === null) continue;
    parsed.push({
      startMs,
      speaker: formatSpeaker(match[2]),
      text: match[3].trim(),
    });
  }
  const segments: HearingTranscriptSegment[] = [];
  for (let idx = 0; idx < parsed.length; idx++) {
    const current = parsed[idx];
    const next = parsed[idx + 1];
    segments.push(
      segment(
        hearingJobId,
        current.startMs,
        next ? Math.max(next.startMs - 250, current.startMs + 1000) : current.startMs + 15000,
        current.speaker,
        current.text,
        source,
      ),
    );
  }
  return segments;
}

function parseSpeakerParagraphs(
  hearingJobId: string,
  text: string,
  source: TranscriptSource,
): HearingTranscriptSegment[] {
  const normalized = text.replace(/\r/g, "").trim();
  if (!normalized) return [];
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const segments: HearingTranscriptSegment[] = [];
  let cursorMs = 0;
  for (const paragraph of paragraphs) {
    const match = paragraph.match(/^([A-Z][A-Za-z .,'’()-]{1,80}):\s+(.+)$/);
    const body = match?.[2] ?? paragraph;
    const approxMs = Math.max(8000, Math.round(body.split(/\s+/).length / 2.3) * 1000);
    segments.push(
      segment(
        hearingJobId,
        cursorMs,
        cursorMs + approxMs,
        match?.[1] ?? "Unknown Speaker",
        body,
        source,
      ),
    );
    cursorMs += approxMs;
  }
  return segments;
}

export function parseTranscriptText(args: {
  hearingJobId: string;
  text: string;
  source?: TranscriptSource;
  filename?: string;
}): HearingTranscriptSegment[] {
  const source = args.source ?? "manual";
  const text = args.text.trim();
  if (!text) return [];
  const filename = args.filename?.toLowerCase() ?? "";
  let segments: HearingTranscriptSegment[] = [];
  if (filename.endsWith(".vtt") || /^WEBVTT/i.test(text)) {
    segments = parseVtt(args.hearingJobId, text, source);
  }
  if (segments.length === 0 && (filename.endsWith(".srt") || /-->|–>|—>/.test(text))) {
    segments = parseSrt(args.hearingJobId, text, source);
  }
  if (segments.length === 0) {
    segments = parseTimestampedLines(args.hearingJobId, text, source);
  }
  if (segments.length === 0) {
    segments = parseSpeakerParagraphs(args.hearingJobId, text, source);
  }
  return mergeShortSegments(segments);
}

function mergeShortSegments(segments: HearingTranscriptSegment[]): HearingTranscriptSegment[] {
  if (segments.length < 2) return segments;
  const merged: HearingTranscriptSegment[] = [];
  for (const current of segments) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.speakerLabel === current.speakerLabel &&
      current.text.length < 160 &&
      previous.text.length < 900
    ) {
      merged[merged.length - 1] = HearingTranscriptSegmentSchema.parse({
        ...previous,
        endMs: current.endMs,
        text: `${previous.text} ${current.text}`.trim(),
        asrConfidence: Math.min(previous.asrConfidence, current.asrConfidence),
        speakerConfidence: Math.min(previous.speakerConfidence, current.speakerConfidence),
      });
    } else {
      merged.push(current);
    }
  }
  return merged;
}

export function transcriptText(segments: HearingTranscriptSegment[]): string {
  return segments
    .map(
      (segment) =>
        `[${formatMs(segment.startMs)}] ${segment.speakerLabel}: ${segment.text}`,
    )
    .join("\n");
}

export function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export async function fetchTranscriptFromUrl(args: {
  hearingJobId: string;
  url: string;
}): Promise<HearingTranscriptSegment[]> {
  const response = await fetch(args.url, {
    headers: {
      "user-agent": "AutoApprops Hearing Intelligence/0.1",
      accept: "text/vtt,application/x-subrip,text/plain,text/html,*/*",
    },
  });
  if (!response.ok) {
    throw new Error(`Transcript URL returned HTTP ${response.status}`);
  }
  const text = await response.text();
  return parseTranscriptText({
    hearingJobId: args.hearingJobId,
    text,
    source: /official|house\.gov|senate\.gov|govinfo/i.test(args.url)
      ? "official_transcript"
      : "official_caption",
    filename: new URL(args.url).pathname,
  });
}

async function commandAvailable(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

async function findFirstFile(dir: string, predicate: (filename: string) => boolean): Promise<string | null> {
  const entries = await fs.readdir(dir);
  const found = entries.find(predicate);
  return found ? path.join(dir, found) : null;
}

async function downloadMedia(mediaUrl: string, workDir: string): Promise<string> {
  const ytDlpPath = await requireMediaTool("yt-dlp");
  const template = path.join(workDir, "source.%(ext)s");
  await execFileAsync(
    ytDlpPath,
    ["-f", "ba/bestaudio/best", "--no-playlist", "-o", template, mediaUrl],
    { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 * 10 },
  );
  const downloaded = await findFirstFile(workDir, (filename) =>
    filename.startsWith("source."),
  );
  if (downloaded) return downloaded;
  throw new Error("yt-dlp completed without producing a media file.");
}

async function extractAudio(mediaPath: string, workDir: string): Promise<string> {
  const ffmpegPath = await requireMediaTool("ffmpeg");
  const audioPath = path.join(workDir, "audio.wav");
  await execFileAsync(
    ffmpegPath,
    ["-y", "-i", mediaPath, "-vn", "-ac", "1", "-ar", "16000", audioPath],
    { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 * 10 },
  );
  return audioPath;
}

async function runWhisper(audioPath: string, workDir: string): Promise<string> {
  if (await commandAvailable("whisper", ["--help"])) {
    await execFileAsync(
      "whisper",
      [
        audioPath,
        "--model",
        process.env.HEARING_WHISPER_MODEL ?? "base",
        "--output_format",
        "srt",
        "--output_dir",
        workDir,
      ],
      { timeout: 60 * 60 * 1000, maxBuffer: 1024 * 1024 * 20 },
    );
    const srt = await findFirstFile(workDir, (filename) => filename.endsWith(".srt"));
    if (srt) return await fs.readFile(srt, "utf-8");
  }

  if (await commandAvailable("whisper-cli", ["--help"])) {
    const outputBase = path.join(workDir, "transcript");
    await execFileAsync(
      "whisper-cli",
      ["-f", audioPath, "-osrt", "-of", outputBase],
      { timeout: 60 * 60 * 1000, maxBuffer: 1024 * 1024 * 20 },
    );
    return await fs.readFile(`${outputBase}.srt`, "utf-8");
  }

  throw new Error("Install OpenAI Whisper CLI or whisper-cli to transcribe media.");
}

export async function transcribeMediaFromUrl(args: {
  hearingJobId: string;
  mediaUrl: string;
}): Promise<HearingTranscriptSegment[]> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "hearing-asr-"));
  try {
    const mediaPath = await downloadMedia(args.mediaUrl, workDir);
    const audioPath = await extractAudio(mediaPath, workDir);
    const srtText = await runWhisper(audioPath, workDir);
    return parseTranscriptText({
      hearingJobId: args.hearingJobId,
      text: srtText,
      source: "asr",
      filename: "transcript.srt",
    });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
