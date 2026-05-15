import { settings } from "./config";
import {
  getCongressionalCache,
  putCongressionalCache,
} from "./hearing-store";

const DAY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;

export interface BillReference {
  raw: string;
  congress?: string;
  billType?: string;
  billNumber?: string;
}

export interface CongressionalContext {
  bill_references: BillReference[];
  bills: Array<Record<string, unknown>>;
  amendments: Array<Record<string, unknown>>;
  members: Array<Record<string, unknown>>;
  committees: Array<Record<string, unknown>>;
  official_sources: Array<{
    title: string;
    url: string;
    source_type: string;
    reliability_tier: number;
  }>;
  warnings: string[];
}

function env(name: string): string {
  return process.env[name] ?? "";
}

function withTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, {
    signal: controller.signal,
    headers: {
      "user-agent": "AutoApprops Hearing Intelligence/0.1",
      accept: "application/json,text/plain,*/*",
    },
  }).finally(() => clearTimeout(timer));
}

function normalizeBillType(raw: string): string | null {
  const lowered = raw.toLowerCase().replace(/\s+/g, "");
  if (/^hr$|^h\.?r\.?$/.test(lowered)) return "hr";
  if (/^s$|^s\.$/.test(lowered)) return "s";
  if (/^hres$|^h\.?res\.?$/.test(lowered)) return "hres";
  if (/^sres$|^s\.?res\.?$/.test(lowered)) return "sres";
  if (/^hjres$|^h\.?j\.?res\.?$/.test(lowered)) return "hjres";
  if (/^sjres$|^s\.?j\.?res\.?$/.test(lowered)) return "sjres";
  return null;
}

export function extractBillReferences(text: string, congress?: string): BillReference[] {
  const refs: BillReference[] = [];
  const seen = new Set<string>();
  const pattern =
    /\b(H\.?\s*R\.?|S\.|H\.?\s*Res\.?|S\.?\s*Res\.?|H\.?\s*J\.?\s*Res\.?|S\.?\s*J\.?\s*Res\.?)\s*(\d{1,5})\b/gi;
  for (const match of text.matchAll(pattern)) {
    const billType = normalizeBillType(match[1]);
    if (!billType) continue;
    const billNumber = match[2];
    const key = `${congress ?? "current"}:${billType}:${billNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({
      raw: match[0].replace(/\s+/g, " ").trim(),
      congress,
      billType,
      billNumber,
    });
  }
  return refs;
}

function congressGovUrl(path: string, params: Record<string, string> = {}): string {
  const url = new URL(`https://api.congress.gov/v3/${path.replace(/^\/+/, "")}`);
  url.searchParams.set("format", "json");
  const key = env("CONGRESS_GOV_API_KEY");
  if (key) url.searchParams.set("api_key", key);
  for (const [name, value] of Object.entries(params)) {
    if (value) url.searchParams.set(name, value);
  }
  return url.toString();
}

function govInfoUrl(path: string, params: Record<string, string> = {}): string {
  const url = new URL(`https://api.govinfo.gov/${path.replace(/^\/+/, "")}`);
  const key = env("GOVINFO_API_KEY");
  if (key) url.searchParams.set("api_key", key);
  for (const [name, value] of Object.entries(params)) {
    if (value) url.searchParams.set(name, value);
  }
  return url.toString();
}

async function getJsonCached(
  cacheKey: string,
  source: string,
  url: string,
  ttlMs: number,
): Promise<Record<string, unknown> | null> {
  const cached = getCongressionalCache(cacheKey);
  if (cached && typeof cached === "object" && !Array.isArray(cached)) {
    return cached as Record<string, unknown>;
  }
  const response = await withTimeout(url);
  if (!response.ok) {
    throw new Error(`${source} returned HTTP ${response.status}`);
  }
  const value = (await response.json()) as Record<string, unknown>;
  putCongressionalCache(cacheKey, source, value, ttlMs);
  return value;
}

async function fetchBill(ref: BillReference): Promise<Record<string, unknown> | null> {
  if (!ref.congress || !ref.billType || !ref.billNumber) return null;
  const path = `bill/${ref.congress}/${ref.billType}/${ref.billNumber}`;
  return getJsonCached(
    `congressgov:${path}`,
    "congress.gov",
    congressGovUrl(path),
    DAY_MS,
  );
}

async function fetchBillSummary(ref: BillReference): Promise<Record<string, unknown> | null> {
  if (!ref.congress || !ref.billType || !ref.billNumber) return null;
  const path = `bill/${ref.congress}/${ref.billType}/${ref.billNumber}/summaries`;
  return getJsonCached(
    `congressgov:${path}`,
    "congress.gov",
    congressGovUrl(path),
    DAY_MS,
  );
}

async function fetchCommitteeSearch(
  committee: string,
): Promise<Record<string, unknown> | null> {
  if (!committee.trim()) return null;
  const path = "committee";
  return getJsonCached(
    `congressgov:committee:${committee.toLowerCase()}`,
    "congress.gov",
    congressGovUrl(path, { q: committee }),
    7 * DAY_MS,
  );
}

async function fetchGovInfoHearings(query: string): Promise<Record<string, unknown> | null> {
  if (!query.trim()) return null;
  return getJsonCached(
    `govinfo:search:CHRG:${query.toLowerCase()}`,
    "govinfo",
    govInfoUrl("search", {
      query: `"${query.slice(0, 80)}" collection:CHRG`,
      pageSize: "10",
      offsetMark: "*",
    }),
    7 * DAY_MS,
  );
}

function attachSummary(
  billPayload: Record<string, unknown>,
  summaryPayload: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!summaryPayload) return billPayload;
  return {
    ...billPayload,
    summaries: summaryPayload.summaries ?? summaryPayload,
  };
}

export async function getCongressionalContext(args: {
  hearingTitle: string;
  committee: string;
  sourceUrl: string;
  transcriptText?: string;
  billReferences?: string[];
  congress?: string;
}): Promise<CongressionalContext> {
  const warnings: string[] = [];
  const text = [
    args.hearingTitle,
    args.committee,
    args.sourceUrl,
    args.transcriptText ?? "",
    ...(args.billReferences ?? []),
  ].join("\n");
  const congress = args.congress ?? env("CURRENT_CONGRESS") ?? "119";
  const refs = extractBillReferences(text, congress || undefined);

  const bills: Array<Record<string, unknown>> = [];
  for (const ref of refs.slice(0, 12)) {
    try {
      const [bill, summary] = await Promise.all([
        fetchBill(ref),
        fetchBillSummary(ref),
      ]);
      if (bill) bills.push(attachSummary(bill, summary));
    } catch (err) {
      warnings.push(
        `Could not fetch Congress.gov context for ${ref.raw}: ${
          err instanceof Error ? err.message : String(err)
        }.`,
      );
    }
  }

  const committees: Array<Record<string, unknown>> = [];
  try {
    const committeePayload = await fetchCommitteeSearch(args.committee);
    if (committeePayload) committees.push(committeePayload);
  } catch (err) {
    warnings.push(
      `Could not fetch committee context: ${err instanceof Error ? err.message : String(err)}.`,
    );
  }

  const officialSources = [
    {
      title: "Congress.gov API",
      url: "https://api.congress.gov/",
      source_type: "congress_gov_api",
      reliability_tier: 3,
    },
    {
      title: "GovInfo API",
      url: "https://www.govinfo.gov/developers",
      source_type: "govinfo_api",
      reliability_tier: 3,
    },
  ];

  try {
    const govInfo = await fetchGovInfoHearings(args.hearingTitle);
    if (govInfo) {
      officialSources.push({
        title: "GovInfo Congressional Hearings Search",
        url: "https://www.govinfo.gov/app/collection/chrg",
        source_type: "govinfo_hearings",
        reliability_tier: 3,
      });
      bills.push({ govinfo_hearing_search: govInfo });
    }
  } catch (err) {
    warnings.push(
      `Could not fetch GovInfo hearing context: ${err instanceof Error ? err.message : String(err)}.`,
    );
  }

  if (!env("CONGRESS_GOV_API_KEY")) {
    warnings.push("CONGRESS_GOV_API_KEY is not configured; Congress.gov calls may be rate-limited or rejected.");
  }
  if (!env("GOVINFO_API_KEY")) {
    warnings.push("GOVINFO_API_KEY is not configured; GovInfo calls may be rate-limited or rejected.");
  }

  return {
    bill_references: refs,
    bills,
    amendments: [],
    members: [],
    committees,
    official_sources: officialSources,
    warnings,
  };
}

export function summarizeCongressionalContext(context: CongressionalContext): string {
  const lines: string[] = [];
  if (context.bill_references.length > 0) {
    lines.push(
      `Bill references detected: ${context.bill_references
        .map((ref) => ref.raw)
        .join(", ")}.`,
    );
  }
  if (context.bills.length > 0) {
    lines.push(`Official bill/context records fetched: ${context.bills.length}.`);
  }
  if (context.committees.length > 0) {
    lines.push("Committee metadata was requested from Congress.gov.");
  }
  if (context.warnings.length > 0) {
    lines.push(`Context warnings: ${context.warnings.join(" ")}`);
  }
  return lines.join("\n");
}

export function hearingAiModelMetadata(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: "anthropic",
    model: settings.model_name,
    congress_gov_api: Boolean(env("CONGRESS_GOV_API_KEY")),
    govinfo_api: Boolean(env("GOVINFO_API_KEY")),
    ...extra,
  };
}
