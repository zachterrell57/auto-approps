import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import {
  HearingResolvedMetadataSchema,
  type HearingExternalSource,
  type HearingResolvedMetadata,
  type HearingStreamCandidate,
  type HearingWitness,
} from "./hearing-models";
import {
  isYoutubeHost,
  normalizeYoutubeVideoInput,
  type YoutubeSourceMetadata,
} from "./youtube-source";

const FETCH_TIMEOUT_MS = 12000;

const COMMITTEE_HINTS: Array<[RegExp, string, string]> = [
  [/appropriations/i, "Appropriations", ""],
  [/energycommerce|energy-and-commerce|energy commerce/i, "Energy and Commerce", ""],
  [/waysandmeans|ways-and-means|ways means/i, "Ways and Means", ""],
  [/judiciary/i, "Judiciary", ""],
  [/oversight/i, "Oversight and Accountability", ""],
  [/homeland/i, "Homeland Security", ""],
  [/banking/i, "Banking, Housing, and Urban Affairs", ""],
  [/finance/i, "Finance", ""],
  [/help\.senate|health-education-labor-pensions|labor/i, "Health, Education, Labor, and Pensions", ""],
];

function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, {
    signal: controller.signal,
    headers: {
      "user-agent": "AutoApprops Hearing Intelligence/0.1",
      accept: "text/html,application/json,text/plain,*/*",
    },
  }).finally(() => clearTimeout(timer));
}

function normalizeUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Hearing URL is required.");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid hearing URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP(S) hearing URLs are supported.");
  }
  return parsed;
}

function textContent($: cheerio.CheerioAPI, selector: string): string {
  return $(selector).first().text().replace(/\s+/g, " ").trim();
}

function metaContent($: cheerio.CheerioAPI, name: string): string {
  return (
    $(`meta[property="${name}"]`).attr("content") ??
    $(`meta[name="${name}"]`).attr("content") ??
    ""
  )
    .replace(/\s+/g, " ")
    .trim();
}

function inferChamber(hostname: string, urlText: string): string {
  const haystack = `${hostname} ${urlText}`;
  if (/senate/i.test(haystack)) return "Senate";
  if (/house|docs\.house\.gov/i.test(haystack)) return "House";
  return "";
}

function inferCommittee(hostname: string, path: string, title: string): string {
  const haystack = `${hostname} ${path} ${title}`;
  for (const [pattern, committee] of COMMITTEE_HINTS) {
    if (pattern.test(haystack)) return committee;
  }
  return "";
}

function inferDateTime($: cheerio.CheerioAPI, title: string): string | null {
  const metaDate =
    metaContent($, "article:published_time") ||
    metaContent($, "date") ||
    metaContent($, "dc.date") ||
    $("time").first().attr("datetime") ||
    textContent($, "time");
  const candidates = [
    metaDate,
    title,
    $("body").text().replace(/\s+/g, " ").slice(0, 4000),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = candidate.match(
      /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+\d{4}\b/i,
    );
    if (match) {
      const parsed = new Date(match[0]);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    const iso = candidate.match(/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?\b/);
    if (iso) {
      const parsed = new Date(iso[0]);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }
  return null;
}

function extractWitnesses($: cheerio.CheerioAPI): HearingWitness[] {
  const witnesses: HearingWitness[] = [];
  const seen = new Set<string>();
  const selectors = [
    "[class*=witness] li",
    "[id*=witness] li",
    "section:contains('Witness') li",
    "h2:contains('Witness') + ul li",
    "h3:contains('Witness') + ul li",
  ];

  for (const selector of selectors) {
    $(selector).each((_idx, el) => {
      const raw = $(el).text().replace(/\s+/g, " ").trim();
      if (!raw || raw.length < 3 || seen.has(raw.toLowerCase())) return;
      seen.add(raw.toLowerCase());
      const [name = raw, ...rest] = raw.split(/\s+[-–—]\s+/);
      witnesses.push({
        name: name.trim(),
        title: rest.join(" - ").trim(),
        organization: "",
        statement_url: $(el).find("a[href$='.pdf']").first().attr("href") ?? "",
      });
    });
  }
  return witnesses.slice(0, 30);
}

function absoluteUrl(base: URL, maybeUrl: string): string {
  try {
    return new URL(maybeUrl, base).toString();
  } catch {
    return maybeUrl;
  }
}

function isOfficialStream(base: URL, streamUrl: string): boolean {
  try {
    const sourceHost = base.hostname.toLowerCase();
    const streamHost = new URL(streamUrl).hostname.toLowerCase();
    if (streamHost === sourceHost || streamHost.endsWith(`.${sourceHost}`)) return true;
    if (streamHost.endsWith(".house.gov") || streamHost.endsWith(".senate.gov")) return true;
    if (
      isYoutubeHost(streamHost) &&
      (sourceHost.endsWith(".house.gov") || sourceHost.endsWith(".senate.gov"))
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function candidateConfidence(
  candidate: HearingStreamCandidate,
  contextPriority: number,
): number {
  const sourceBoost =
    candidate.source === "iframe" || candidate.source === "video"
      ? 0.08
      : candidate.source === "metadata"
        ? 0.03
        : 0;
  const officialBoost = candidate.official ? 0.04 : 0;
  return Math.max(0.2, Math.min(0.99, 0.82 + sourceBoost + officialBoost + contextPriority));
}

function contextPriority($: cheerio.CheerioAPI, el: AnyNode): number {
  const node = $(el);
  if (
    node.closest(
      "article, main, [role='main'], .page__content, .evo-markup__body, .evo-hearing__body, .evo-business-meetings__body",
    ).length > 0
  ) {
    return 0.1;
  }
  if (
    node.closest(
      "header, nav, footer, [role='banner'], [role='navigation'], .navbar, .menu, .page__banner, .evo-banner",
    ).length > 0
  ) {
    return -0.18;
  }
  return 0;
}

function pushYoutubeCandidate(
  candidates: HearingStreamCandidate[],
  seen: Set<string>,
  base: URL,
  rawUrl: string,
  label: string,
  source: HearingStreamCandidate["source"],
  contextPriorityValue: number,
): YoutubeSourceMetadata | null {
  if (!rawUrl || /^mailto:|^tel:|^javascript:/i.test(rawUrl)) return null;
  const absolute = absoluteUrl(base, rawUrl);
  const youtubeSource = normalizeYoutubeVideoInput(absolute);
  if (!youtubeSource || seen.has(youtubeSource.url)) return null;
  const candidate: HearingStreamCandidate = {
    url: youtubeSource.url,
    provider: "youtube",
    label: label.trim(),
    confidence: 0.5,
    source,
    official: isOfficialStream(base, youtubeSource.url),
  };
  candidate.confidence = candidateConfidence(candidate, contextPriorityValue);
  seen.add(youtubeSource.url);
  candidates.push(candidate);
  return youtubeSource;
}

function pushYoutubeCandidateFromSource(
  candidates: HearingStreamCandidate[],
  seen: Set<string>,
  base: URL,
  youtubeSource: YoutubeSourceMetadata,
  label: string,
  source: HearingStreamCandidate["source"],
  contextPriorityValue: number,
): void {
  if (seen.has(youtubeSource.url)) return;
  const candidate: HearingStreamCandidate = {
    url: youtubeSource.url,
    provider: "youtube",
    label: label.trim(),
    confidence: 0.5,
    source,
    official: isOfficialStream(base, youtubeSource.url),
  };
  candidate.confidence = candidateConfidence(candidate, contextPriorityValue);
  seen.add(youtubeSource.url);
  candidates.push(candidate);
}

function extractYoutubeCandidates(
  $: cheerio.CheerioAPI,
  base: URL,
): { candidates: HearingStreamCandidate[]; sources: Map<string, YoutubeSourceMetadata> } {
  const candidates: HearingStreamCandidate[] = [];
  const sources = new Map<string, YoutubeSourceMetadata>();
  const seen = new Set<string>();

  $("video[src], video source[src], source[src]").each((_idx, el) => {
    const source = pushYoutubeCandidate(
      candidates,
      seen,
      base,
      $(el).attr("src") ?? "",
      $(el).attr("title") ?? $(el).text().replace(/\s+/g, " ").trim(),
      "video",
      contextPriority($, el),
    );
    if (source) sources.set(source.url, source);
  });

  $("iframe[src], embed[src]").each((_idx, el) => {
    const label = `${$(el).attr("title") ?? ""} ${$(el).attr("aria-label") ?? ""}`.trim();
    const source = pushYoutubeCandidate(
      candidates,
      seen,
      base,
      $(el).attr("src") ?? "",
      label,
      "iframe",
      contextPriority($, el),
    );
    if (source) sources.set(source.url, source);
  });

  $("a[href]").each((_idx, el) => {
    const href = $(el).attr("href") ?? "";
    const label = $(el).text().replace(/\s+/g, " ").trim();
    const source = pushYoutubeCandidate(
      candidates,
      seen,
      base,
      href,
      label,
      "link",
      contextPriority($, el),
    );
    if (source) sources.set(source.url, source);
  });

  const inputSource = normalizeYoutubeVideoInput(base.toString());
  if (inputSource) {
    pushYoutubeCandidateFromSource(
      candidates,
      seen,
      base,
      inputSource,
      "Source URL",
      "metadata",
      0.12,
    );
    sources.set(inputSource.url, inputSource);
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  return { candidates: candidates.slice(0, 12), sources };
}

function extractDocuments($: cheerio.CheerioAPI, base: URL, tier: number): HearingExternalSource[] {
  const docs: HearingExternalSource[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_idx, el) => {
    const href = $(el).attr("href") ?? "";
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!href) return;
    const absolute = absoluteUrl(base, href);
    const lower = absolute.toLowerCase();
    const sourceType = lower.endsWith(".pdf")
      ? "pdf"
      : /transcript|caption/i.test(`${text} ${href}`)
        ? "transcript"
        : /video|youtube|stream/i.test(`${text} ${href}`)
          ? "video"
          : "";
    if (!sourceType || seen.has(absolute)) return;
    seen.add(absolute);
    docs.push({
      title: text || sourceType.toUpperCase(),
      url: absolute,
      source_type: sourceType,
      reliability_tier: tier,
    });
  });
  return docs.slice(0, 50);
}

function extractBillReferences(text: string): string[] {
  const matches = text.match(/\b(?:H\.?\s*R\.?|S\.|H\.?\s*Res\.?|S\.?\s*Res\.?|H\.?\s*J\.?\s*Res\.?|S\.?\s*J\.?\s*Res\.?)\s*\d{1,5}\b/gi) ?? [];
  return Array.from(new Set(matches.map((match) => match.replace(/\s+/g, " ").trim()))).slice(0, 40);
}

function sourceInfo(url: URL): {
  source_type: string;
  tier: number;
  warnings: string[];
} {
  const host = url.hostname.toLowerCase();
  if (host === "docs.house.gov" || host.endsWith(".house.gov")) {
    return { source_type: "house_committee_repository", tier: 1, warnings: [] };
  }
  if (host === "senate.gov" || host.endsWith(".senate.gov")) {
    return { source_type: "senate_hearings", tier: 1, warnings: [] };
  }
  if (host === "congress.gov" || host.endsWith(".congress.gov")) {
    return { source_type: "congress_gov", tier: 3, warnings: [] };
  }
  if (host === "govinfo.gov" || host.endsWith(".govinfo.gov")) {
    return { source_type: "govinfo", tier: 3, warnings: [] };
  }
  if (isYoutubeHost(host)) {
    return {
      source_type: "official_committee_youtube",
      tier: 2,
      warnings: [
        "Verify that this YouTube video is from an official committee channel before using client-facing outputs.",
      ],
    };
  }
  return {
    source_type: "trusted_public_archive",
    tier: 4,
    warnings: [
      "This source is not an official congressional domain. Use only if rights allow and official sources are unavailable.",
    ],
  };
}

function titleFromUrl(url: URL): string {
  const last = url.pathname.split("/").filter(Boolean).pop() ?? "Congressional Hearing";
  return decodeURIComponent(last)
    .replace(/[-_]+/g, " ")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function resolveHearingSource(inputUrl: string): Promise<HearingResolvedMetadata> {
  const url = normalizeUrl(inputUrl);
  const info = sourceInfo(url);
  const warnings = [...info.warnings];

  let html = "";
  try {
    const response = await fetchWithTimeout(url.toString());
    if (!response.ok) {
      warnings.push(`Source returned HTTP ${response.status}; metadata was inferred from the URL.`);
    } else {
      const contentType = response.headers.get("content-type") ?? "";
      if (/text\/html|application\/xhtml/i.test(contentType)) {
        html = await response.text();
      } else {
        warnings.push(`Source content type is ${contentType || "unknown"}; metadata was inferred from the URL.`);
      }
    }
  } catch (err) {
    warnings.push(
      `Could not fetch source metadata: ${err instanceof Error ? err.message : String(err)}.`,
    );
  }

  const $ = cheerio.load(html || "<html></html>");
  const pageTitle =
    metaContent($, "og:title") ||
    textContent($, "h1") ||
    $("title").first().text().replace(/\s+/g, " ").trim() ||
    titleFromUrl(url);
  const bodyText = html ? $("body").text().replace(/\s+/g, " ").trim() : "";
  const chamber = inferChamber(url.hostname, `${url.pathname} ${pageTitle}`);
  const committee = inferCommittee(url.hostname, url.pathname, pageTitle);
  const documents = extractDocuments($, url, info.tier);
  const transcriptDoc = documents.find((doc) => /transcript|caption/i.test(`${doc.title} ${doc.url}`));
  const { candidates: streamCandidates, sources: youtubeSources } =
    extractYoutubeCandidates($, url);
  const bestStream = streamCandidates[0] ?? null;
  const youtubeSource = bestStream ? youtubeSources.get(bestStream.url) ?? null : null;
  if (!youtubeSource) {
    warnings.push("No exact YouTube video was found on this hearing webpage.");
  }

  const metadata = {
    source_url: url.toString(),
    source_type: info.source_type,
    source_reliability_tier: info.tier,
    hearing_title: pageTitle || "Congressional Hearing",
    chamber,
    committee,
    subcommittee: "",
    hearing_datetime: inferDateTime($, pageTitle),
    live_status: youtubeSource
      ? /live|streaming now/i.test(bodyText)
        ? "live"
        : "unknown"
      : "unknown",
    witnesses: extractWitnesses($),
    documents,
    media_url: bestStream?.url ?? "",
    captions_url: "",
    transcript_url: transcriptDoc?.url ?? "",
    stream_url: bestStream?.url ?? "",
    stream_provider: bestStream ? "youtube" : "",
    stream_confidence: bestStream?.confidence ?? 0,
    stream_candidates: streamCandidates,
    youtube_source: youtubeSource,
    warnings,
    bill_references: extractBillReferences(`${pageTitle}\n${bodyText}`),
  };

  return HearingResolvedMetadataSchema.parse(metadata);
}
