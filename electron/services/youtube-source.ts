const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{6,32}$/;

export type YoutubeLiveStatus =
  | "live"
  | "recorded"
  | "scheduled"
  | "unavailable"
  | "unknown";

export interface YoutubeSourceMetadata {
  video_id: string;
  url: string;
  embed_url: string;
  title: string;
  channel: string;
  duration_seconds: number | null;
  live_status: YoutubeLiveStatus;
  resolved_from: string;
  validated_at: string | null;
  probe_error: string;
}

export function isYoutubeHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "youtube.com" ||
    normalized.endsWith(".youtube.com") ||
    normalized === "youtube-nocookie.com" ||
    normalized.endsWith(".youtube-nocookie.com") ||
    normalized === "youtu.be"
  );
}

function cleanVideoId(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = decodeURIComponent(value).trim();
  return YOUTUBE_ID_PATTERN.test(candidate) ? candidate : null;
}

export function extractYoutubeVideoId(rawInput: string): string | null {
  const input = rawInput.trim();
  if (!input) return null;
  const directId = cleanVideoId(input);
  if (directId && !input.includes("/") && !input.includes(".")) return directId;

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (!isYoutubeHost(host)) return null;

  if (host === "youtu.be") {
    return cleanVideoId(parsed.pathname.split("/").filter(Boolean)[0]);
  }

  const queryId = cleanVideoId(parsed.searchParams.get("v"));
  if (queryId) return queryId;

  for (const pattern of [
    /^\/embed\/([^/?#]+)/i,
    /^\/shorts\/([^/?#]+)/i,
    /^\/live\/([^/?#]+)/i,
  ]) {
    const match = parsed.pathname.match(pattern);
    const id = cleanVideoId(match?.[1]);
    if (id) return id;
  }

  return null;
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

export function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
}

export function normalizeYoutubeVideoInput(rawInput: string): YoutubeSourceMetadata | null {
  const videoId = extractYoutubeVideoId(rawInput);
  if (!videoId) return null;
  return {
    video_id: videoId,
    url: youtubeWatchUrl(videoId),
    embed_url: youtubeEmbedUrl(videoId),
    title: "",
    channel: "",
    duration_seconds: null,
    live_status: "unknown",
    resolved_from: rawInput.trim(),
    validated_at: null,
    probe_error: "",
  };
}

export function mapYtDlpLiveStatus(
  liveStatus: unknown,
  duration: unknown,
): YoutubeLiveStatus {
  if (liveStatus === "is_live") return "live";
  if (liveStatus === "is_upcoming") return "scheduled";
  if (liveStatus === "was_live" || liveStatus === "not_live") return "recorded";
  if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
    return "recorded";
  }
  return "unknown";
}
