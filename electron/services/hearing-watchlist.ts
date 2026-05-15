import { v4 as uuidv4 } from "uuid";

import {
  type HearingClientContext,
  type HearingTranscriptSegment,
  type HearingWatchHit,
  type HearingWatchItem,
} from "./hearing-models";

const DEFAULT_PRE_WINDOW_MS = 90_000;
const DEFAULT_POST_WINDOW_MS = 180_000;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function billVariants(value: string): string[] {
  const match = value.match(
    /\b(H\.?\s*R\.?|S\.|H\.?\s*Res\.?|S\.?\s*Res\.?|H\.?\s*J\.?\s*Res\.?|S\.?\s*J\.?\s*Res\.?)\s*(\d{1,5})\b/i,
  );
  if (!match) return [];
  const prefix = match[1].toUpperCase().replace(/\s+/g, "").replace(/\./g, "");
  const num = match[2];
  const readable =
    prefix === "HR"
      ? "House Bill"
      : prefix === "S"
        ? "Senate Bill"
        : prefix === "HRES"
          ? "House Resolution"
          : prefix === "SRES"
            ? "Senate Resolution"
            : prefix === "HJRES"
              ? "House Joint Resolution"
              : prefix === "SJRES"
                ? "Senate Joint Resolution"
                : prefix;
  return [
    `${match[1]} ${num}`,
    `${prefix} ${num}`,
    `${prefix}${num}`,
    `${readable} ${num}`,
  ];
}

function acronym(value: string): string | null {
  const words = value.match(/\b[A-Za-z][A-Za-z]+\b/g) ?? [];
  if (words.length < 2 || words.length > 8) return null;
  return words.map((word) => word[0].toUpperCase()).join("");
}

function termsForItem(item: HearingWatchItem): Array<{
  text: string;
  matchType: HearingWatchHit["matchType"];
}> {
  const terms: Array<{ text: string; matchType: HearingWatchHit["matchType"] }> = [
    { text: item.label, matchType: "exact" },
  ];
  for (const alias of item.aliases) {
    terms.push({ text: alias, matchType: "alias" });
  }
  for (const term of [item.label, ...item.aliases]) {
    for (const variant of billVariants(term)) {
      terms.push({ text: variant, matchType: "bill_normalized" });
    }
    const initials = acronym(term);
    if (initials) terms.push({ text: initials, matchType: "alias" });
  }
  const seen = new Set<string>();
  return terms.filter((term) => {
    const key = normalizeText(term.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasNegativeFilter(segmentText: string, negativeFilters: string[]): boolean {
  const normalized = normalizeText(segmentText);
  return negativeFilters.some((filter) => {
    const normalizedFilter = normalizeText(filter);
    return normalizedFilter && normalized.includes(normalizedFilter);
  });
}

function termMatches(text: string, term: string, semantic: boolean): boolean {
  const normalizedText = normalizeText(text);
  const normalizedTerm = normalizeText(term);
  if (!normalizedTerm) return false;
  const exact = new RegExp(`(^|\\W)${escapeRegex(normalizedTerm)}(\\W|$)`, "i").test(
    normalizedText,
  );
  if (exact) return true;
  if (!semantic) return false;
  const words = normalizedTerm.split(" ").filter((word) => word.length > 3);
  if (words.length < 2) return false;
  const matchedWords = words.filter((word) => normalizedText.includes(word));
  return matchedWords.length / words.length >= 0.75;
}

function hitWindow(
  segments: HearingTranscriptSegment[],
  hitSegment: HearingTranscriptSegment,
): HearingTranscriptSegment[] {
  const start = Math.max(0, hitSegment.startMs - DEFAULT_PRE_WINDOW_MS);
  const end = hitSegment.endMs + DEFAULT_POST_WINDOW_MS;
  return segments.filter(
    (segment) => segment.endMs >= start && segment.startMs <= end,
  );
}

function relevance(
  item: HearingWatchItem,
  clientContext: HearingClientContext,
): string {
  const parts = [`Matched watch item "${item.label}" (${item.type}).`];
  if (clientContext.care_about.trim()) {
    parts.push(`Client care-about instructions: ${clientContext.care_about.trim()}`);
  }
  if (clientContext.priority_bills.includes(item.label)) {
    parts.push("This is listed as a client priority bill.");
  }
  if (clientContext.agencies.includes(item.label)) {
    parts.push("This is listed as a relevant agency for the client.");
  }
  return parts.join(" ");
}

function confidenceFor(
  item: HearingWatchItem,
  matchType: HearingWatchHit["matchType"],
  segment: HearingTranscriptSegment,
): number {
  const base =
    matchType === "exact"
      ? 0.96
      : matchType === "bill_normalized"
        ? 0.95
        : matchType === "alias"
          ? 0.91
          : 0.82;
  const importanceBoost = item.importance === "critical" ? 0.02 : item.importance === "high" ? 0.01 : 0;
  const confidencePenalty = segment.asrConfidence < 0.75 ? 0.08 : 0;
  return Math.max(0.1, Math.min(0.99, base + importanceBoost - confidencePenalty));
}

export function detectWatchlistHits(args: {
  hearingJobId: string;
  watchItems: HearingWatchItem[];
  segments: HearingTranscriptSegment[];
  clientContext: HearingClientContext;
}): HearingWatchHit[] {
  const hits: HearingWatchHit[] = [];
  const seen = new Set<string>();
  const sortedSegments = [...args.segments].sort((a, b) => a.startMs - b.startMs);

  for (const item of args.watchItems) {
    const terms = termsForItem(item);
    const semantic = item.match_mode === "semantic" || item.match_mode === "hybrid";
    for (const segment of sortedSegments) {
      if (hasNegativeFilter(segment.text, item.negative_filters)) continue;
      for (const term of terms) {
        if (!termMatches(segment.text, term.text, semantic)) continue;
        const windowSegments = hitWindow(sortedSegments, segment);
        const startMs = Math.max(
          0,
          Math.min(...windowSegments.map((windowSegment) => windowSegment.startMs)),
        );
        const endMs = Math.max(...windowSegments.map((windowSegment) => windowSegment.endMs));
        const key = `${item.id}:${segment.segmentId}:${normalizeText(term.text)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({
          hitId: uuidv4(),
          watchItemId: item.id,
          hearingJobId: args.hearingJobId,
          triggerText: term.text,
          matchType: term.matchType,
          confidence: confidenceFor(item, term.matchType, segment),
          startMs,
          endMs,
          speakerLabels: Array.from(
            new Set(windowSegments.map((windowSegment) => windowSegment.speakerLabel)),
          ),
          transcriptSegmentIds: windowSegments.map((windowSegment) => windowSegment.segmentId),
          clientRelevance: relevance(item, args.clientContext),
          status: "new",
        });
        break;
      }
    }
  }

  return coalesceHits(hits);
}

function coalesceHits(hits: HearingWatchHit[]): HearingWatchHit[] {
  const sorted = [...hits].sort((a, b) => a.startMs - b.startMs);
  const coalesced: HearingWatchHit[] = [];
  for (const hit of sorted) {
    const previous = coalesced[coalesced.length - 1];
    if (
      previous &&
      previous.watchItemId === hit.watchItemId &&
      hit.startMs <= previous.endMs
    ) {
      coalesced[coalesced.length - 1] = {
        ...previous,
        endMs: Math.max(previous.endMs, hit.endMs),
        confidence: Math.max(previous.confidence, hit.confidence),
        triggerText: Array.from(
          new Set([...previous.triggerText.split(", "), hit.triggerText]),
        ).join(", "),
        speakerLabels: Array.from(new Set([...previous.speakerLabels, ...hit.speakerLabels])),
        transcriptSegmentIds: Array.from(
          new Set([...previous.transcriptSegmentIds, ...hit.transcriptSegmentIds]),
        ),
      };
    } else {
      coalesced.push(hit);
    }
  }
  return coalesced;
}
