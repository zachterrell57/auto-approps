import fs from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";

import { settings } from "./config";
import {
  providerUsageAndCostFields,
  type ProviderUsageRecord,
} from "./hearing-cost";
import {
  HearingTranscriptSegmentSchema,
  type HearingTranscriptSegment,
  type SpeakerType,
} from "./hearing-models";
import { parseTranscriptText } from "./hearing-transcript";

type OpenAiTranscriptSegment = {
  start?: number;
  end?: number;
  text?: string;
  speaker?: string;
  speaker_label?: string;
  confidence?: number;
};

type OpenAiTranscriptResponse = {
  text?: string;
  segments?: OpenAiTranscriptSegment[];
  [key: string]: unknown;
};

export interface LiveTranscriptionResult {
  segments: HearingTranscriptSegment[];
  providerUsage: ProviderUsageRecord;
}

function speakerType(speaker: string): SpeakerType {
  if (/chair|chairman|chairwoman|ranking member/i.test(speaker)) return "chair";
  if (/sen\.|senator|rep\.|representative|delegate/i.test(speaker)) return "member";
  if (/secretary|administrator|director|president|ceo|witness/i.test(speaker)) {
    return "witness";
  }
  return "unknown";
}

function confidence(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

function offsetParsedSegments(
  hearingJobId: string,
  text: string,
  offsetMs: number,
): HearingTranscriptSegment[] {
  return parseTranscriptText({
    hearingJobId,
    text,
    source: "live_asr",
    filename: "live-transcript.txt",
  }).map((segment) =>
    HearingTranscriptSegmentSchema.parse({
      ...segment,
      segmentId: uuidv4(),
      startMs: segment.startMs + offsetMs,
      endMs: segment.endMs + offsetMs,
      source: "live_asr",
    }),
  );
}

function diarizedSegments(args: {
  hearingJobId: string;
  offsetMs: number;
  segments: OpenAiTranscriptSegment[];
}): HearingTranscriptSegment[] {
  return args.segments
    .map((entry) => {
      const text = (entry.text ?? "").trim();
      if (!text) return null;
      const startMs = Math.max(0, Math.round((entry.start ?? 0) * 1000)) + args.offsetMs;
      const endMs =
        Math.max(
          Math.round((entry.end ?? entry.start ?? 0) * 1000),
          Math.round((entry.start ?? 0) * 1000) + 1000,
        ) + args.offsetMs;
      const speaker = (entry.speaker_label ?? entry.speaker ?? "Unknown Speaker").trim();
      return HearingTranscriptSegmentSchema.parse({
        segmentId: uuidv4(),
        hearingJobId: args.hearingJobId,
        startMs,
        endMs,
        speakerLabel: speaker || "Unknown Speaker",
        speakerType: speakerType(speaker),
        text,
        asrConfidence: confidence(entry.confidence, 0.84),
        speakerConfidence: speaker && !/unknown/i.test(speaker) ? 0.76 : 0.35,
        source: "live_asr",
        reviewStatus: speaker && !/unknown/i.test(speaker) ? "unreviewed" : "needs_review",
      });
    })
    .filter((segment): segment is HearingTranscriptSegment => Boolean(segment));
}

async function callOpenAiTranscription(
  audioPath: string,
  model: string,
): Promise<{ response: OpenAiTranscriptResponse; providerUsage: ProviderUsageRecord }> {
  const apiKey = settings.openai_api_key || process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    throw new Error("OpenAI API key is required for live hearing transcription.");
  }

  const bytes = await fs.readFile(audioPath);
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: "audio/wav" }),
    path.basename(audioPath),
  );
  form.append("model", model);
  form.append("response_format", "json");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(
      `OpenAI transcription failed for ${model}: HTTP ${response.status}${message ? ` ${message.slice(0, 300)}` : ""}`,
    );
  }

  const raw = await response.json();
  if (!raw || typeof raw !== "object") {
    throw new Error("OpenAI transcription returned an invalid response.");
  }
  const rawRecord = raw as Record<string, unknown>;
  const { usage, costFields, costUsd } = providerUsageAndCostFields(rawRecord);
  return {
    response: raw as OpenAiTranscriptResponse,
    providerUsage: {
      provider: "openai",
      service: "transcription",
      model,
      cost_usd: costUsd,
      usage,
      ...(costUsd === null ? { unavailable_reason: "transcription unavailable" } : {}),
      ...(Object.keys(costFields).length > 0
        ? { provider_cost_fields: costFields }
        : {}),
    },
  };
}

export async function transcribeLiveAudioChunk(args: {
  hearingJobId: string;
  audioPath: string;
  offsetMs: number;
}): Promise<LiveTranscriptionResult> {
  const preferred = process.env.HEARING_TRANSCRIPTION_MODEL || "gpt-4o-transcribe-diarize";
  const fallback = "gpt-4o-transcribe";
  let result: { response: OpenAiTranscriptResponse; providerUsage: ProviderUsageRecord };
  try {
    result = await callOpenAiTranscription(args.audioPath, preferred);
  } catch (err) {
    if (preferred === fallback) throw err;
    result = await callOpenAiTranscription(args.audioPath, fallback);
  }

  const response = result.response;
  if (Array.isArray(response.segments) && response.segments.length > 0) {
    const segments = diarizedSegments({
      hearingJobId: args.hearingJobId,
      offsetMs: args.offsetMs,
      segments: response.segments,
    });
    if (segments.length > 0) {
      return { segments, providerUsage: result.providerUsage };
    }
  }

  const text = (response.text ?? "").trim();
  return {
    segments: text ? offsetParsedSegments(args.hearingJobId, text, args.offsetMs) : [],
    providerUsage: result.providerUsage,
  };
}
