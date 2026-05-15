import * as cheerio from "cheerio";

import {
  HearingResolvedMetadataSchema,
  type HearingExternalSource,
  type HearingResolvedMetadata,
  type HearingStreamCandidate,
  type HearingWitness,
} from "./hearing-models";

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

function providerForUrl(rawUrl: string): string {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") {
      return "youtube";
    }
    if (host.includes("house.gov")) return "house_committee";
    if (host.includes("senate.gov")) return "senate_committee";
    if (/vimeo|boxcast|livestream|brightcove|akamaized|cloudfront|m3u8/i.test(rawUrl)) {
      return "embedded_stream";
    }
    return host.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function isOfficialStream(base: URL, streamUrl: string): boolean {
  try {
    const sourceHost = base.hostname.toLowerCase();
    const streamHost = new URL(streamUrl).hostname.toLowerCase();
    if (streamHost === sourceHost || streamHost.endsWith(`.${sourceHost}`)) return true;
    if (streamHost.endsWith(".house.gov") || streamHost.endsWith(".senate.gov")) return true;
    if (
      (streamHost === "youtube.com" || streamHost.endsWith(".youtube.com") || streamHost === "youtu.be") &&
      (sourceHost.endsWith(".house.gov") || sourceHost.endsWith(".senate.gov"))
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function candidateConfidence(candidate: HearingStreamCandidate): number {
  const providerBoost =
    candidate.provider === "house_committee" || candidate.provider === "senate_committee"
      ? 0.95
      : candidate.provider === "youtube"
        ? 0.86
        : 0.72;
  const sourceBoost = candidate.source === "video" ? 0.08 : candidate.source === "iframe" ? 0.04 : 0;
  const officialBoost = candidate.official ? 0.06 : -0.08;
  return Math.max(0.2, Math.min(0.99, providerBoost + sourceBoost + officialBoost));
}

function pushCandidate(
  candidates: HearingStreamCandidate[],
  seen: Set<string>,
  base: URL,
  rawUrl: string,
  label: string,
  source: HearingStreamCandidate["source"],
): void {
  if (!rawUrl || /^mailto:|^tel:|^javascript:/i.test(rawUrl)) return;
  const absolute = absoluteUrl(base, rawUrl);
  if (!/^https?:\/\//i.test(absolute) || seen.has(absolute)) return;
  const haystack = `${absolute} ${label}`;
  if (
    !/youtube|youtu\.be|live|stream|webcast|video|watch|embed|m3u8|mpd|brightcove|boxcast|vimeo|livestream/i.test(
      haystack,
    )
  ) {
    return;
  }
  const provider = providerForUrl(absolute);
  const official = isOfficialStream(base, absolute);
  const candidate: HearingStreamCandidate = {
    url: absolute,
    provider,
    label: label.trim(),
    confidence: 0.5,
    source,
    official,
  };
  candidate.confidence = candidateConfidence(candidate);
  seen.add(absolute);
  candidates.push(candidate);
}

function extractStreamCandidates($: cheerio.CheerioAPI, base: URL): HearingStreamCandidate[] {
  const candidates: HearingStreamCandidate[] = [];
  const seen = new Set<string>();

  $("video[src], video source[src], source[src]").each((_idx, el) => {
    pushCandidate(
      candidates,
      seen,
      base,
      $(el).attr("src") ?? "",
      $(el).attr("title") ?? $(el).text().replace(/\s+/g, " ").trim(),
      "video",
    );
  });

  $("iframe[src], embed[src]").each((_idx, el) => {
    const label = `${$(el).attr("title") ?? ""} ${$(el).attr("aria-label") ?? ""}`.trim();
    pushCandidate(candidates, seen, base, $(el).attr("src") ?? "", label, "iframe");
  });

  $("a[href]").each((_idx, el) => {
    const href = $(el).attr("href") ?? "";
    const label = $(el).text().replace(/\s+/g, " ").trim();
    pushCandidate(candidates, seen, base, href, label, "link");
  });

  return candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 12);
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
  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") {
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
  const videoDoc = documents.find((doc) => /video|youtube|stream/i.test(`${doc.title} ${doc.url}`));
  const streamCandidates = extractStreamCandidates($, url);
  if (videoDoc) {
    pushCandidate(
      streamCandidates,
      new Set(streamCandidates.map((candidate) => candidate.url)),
      url,
      videoDoc.url,
      videoDoc.title,
      "metadata",
    );
    streamCandidates.sort((a, b) => b.confidence - a.confidence);
  }
  const bestStream = streamCandidates[0] ?? null;

  const metadata = {
    source_url: url.toString(),
    source_type: info.source_type,
    source_reliability_tier: info.tier,
    hearing_title: pageTitle || "Congressional Hearing",
    chamber,
    committee,
    subcommittee: "",
    hearing_datetime: inferDateTime($, pageTitle),
    live_status: /live|streaming now/i.test(bodyText) ? "live" : "unknown",
    witnesses: extractWitnesses($),
    documents,
    media_url: bestStream?.url ?? videoDoc?.url ?? "",
    captions_url: "",
    transcript_url: transcriptDoc?.url ?? "",
    stream_url: bestStream?.url ?? "",
    stream_provider: bestStream?.provider ?? "",
    stream_confidence: bestStream?.confidence ?? 0,
    stream_candidates: streamCandidates,
    warnings,
    bill_references: extractBillReferences(`${pageTitle}\n${bodyText}`),
  };

  return HearingResolvedMetadataSchema.parse(metadata);
}
