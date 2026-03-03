// ---------------------------------------------------------------------------
// Google Forms scraper
// ---------------------------------------------------------------------------

import type { FieldType, FormField, FormSchema } from "./models";
import { settings } from "./config";

// Maps the internal Google Forms type code to our FieldType.
const TYPE_MAP: Record<number, FieldType> = {
  0: "short_text",
  1: "long_text",
  2: "radio",
  3: "dropdown",
  4: "checkbox",
  5: "linear_scale",
  9: "date",
  10: "time",
};

/**
 * Scrape a Google Form and return a structured FormSchema.
 *
 * Uses Node's built-in `fetch()` (available in Node 18+).
 */
export async function scrapeForm(url: string): Promise<FormSchema> {
  // Normalise the URL so we always hit the public /viewform endpoint.
  url = url.replace(/\/edit(\?.*)?$/, "/viewform");
  if (!url.includes("/viewform")) {
    url = url.replace(/\/+$/, "") + "/viewform";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.google_form_fetch_timeout_ms);

  let resp: Response;
  try {
    resp = await fetch(url, { redirect: "follow", signal: controller.signal });
  } catch (e) {
    const message =
      e instanceof Error && e.name === "AbortError"
        ? `Timed out fetching form after ${settings.google_form_fetch_timeout_ms}ms`
        : `Failed to fetch form: ${String(e)}`;
    throw new Error(message);
  } finally {
    clearTimeout(timeout);
  }
  if (!resp.ok) {
    throw new Error(
      `Failed to fetch form (HTTP ${resp.status}): ${resp.statusText}`,
    );
  }
  const html = await resp.text();

  // Detect login-gated forms.
  if (
    html.includes("accounts.google.com/ServiceLogin") ||
    html.includes("accounts.google.com/v3/signin")
  ) {
    throw new Error(
      "This form requires Google login. Only publicly-accessible forms are supported.",
    );
  }

  let fields = parseFbPublicLoadData(html);
  const title = extractTitle(html);

  if (fields.length === 0) {
    fields = parseEntryIdsFallback(html);
  }

  const pageCount =
    fields.length > 0
      ? Math.max(...fields.map((f) => f.page_index)) + 1
      : 1;

  return {
    title,
    description: "",
    fields,
    page_count: pageCount,
    url,
    provider: "",
    scrape_warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractTitle(html: string): string {
  const match = html.match(/<title>([\s\S]*?)<\/title>/);
  if (match) {
    let title = match[1].trim();
    title = title.replace(/\s*-\s*Google Forms$/, "");
    return title;
  }
  return "Untitled Form";
}

/**
 * Parse the FB_PUBLIC_LOAD_DATA_ blob that Google Forms embeds in every
 * public /viewform page.  This is the richest source of field metadata.
 */
function parseFbPublicLoadData(html: string): FormField[] {
  const match = html.match(
    /var\s+FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/,
  );
  if (!match) return [];

  let data: unknown[];
  try {
    data = JSON.parse(match[1]);
  } catch {
    return [];
  }

  const fields: FormField[] = [];

  // data[1][1] contains the list of form items.
  const items = (data as any)?.[1]?.[1];
  if (!Array.isArray(items)) return [];

  let pageIndex = 0;

  for (const item of items) {
    if (!Array.isArray(item) || item.length < 2) continue;

    const label: string = item[1] ? String(item[1]) : "";

    // type code 8 = page break
    if (item[3] === 8) {
      pageIndex += 1;
      continue;
    }

    const answerData =
      item.length > 4 && Array.isArray(item[4]) ? item[4] : null;
    if (!answerData || answerData.length === 0) continue;

    const fieldMeta = answerData[0];
    if (!Array.isArray(fieldMeta) || fieldMeta.length < 2) continue;

    const typeCode: number =
      fieldMeta.length > 3 ? (fieldMeta[3] as number) : 0;
    const fieldType: FieldType = TYPE_MAP[typeCode] ?? "short_text";
    const entryId = `entry.${fieldMeta[0]}`;
    const required: boolean =
      fieldMeta.length > 2 ? Boolean(fieldMeta[2]) : false;

    const options: string[] = [];
    if (Array.isArray(fieldMeta[1])) {
      for (const opt of fieldMeta[1]) {
        if (Array.isArray(opt) && opt.length > 0 && opt[0] != null) {
          options.push(String(opt[0]));
        }
      }
    }

    fields.push({
      field_id: entryId,
      label,
      field_type: fieldType,
      required,
      options,
      page_index: pageIndex,
    });
  }

  return fields;
}

/**
 * Fallback parser: scrape `name="entry.NNNNN"` attributes when the
 * FB_PUBLIC_LOAD_DATA_ blob is unavailable.
 */
function parseEntryIdsFallback(html: string): FormField[] {
  const fields: FormField[] = [];
  const seen = new Set<string>();

  const pattern = /name="(entry\.\d+)"/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const entryId = match[1];
    if (seen.has(entryId)) continue;
    seen.add(entryId);

    let label = "";
    const labelPattern = new RegExp(
      `aria-label="([^"]*)"[^>]*name="${entryId.replace(/\./g, "\\.")}"`,
    );
    const labelMatch = html.match(labelPattern);
    if (labelMatch) {
      label = labelMatch[1];
    }

    fields.push({
      field_id: entryId,
      label: label || entryId,
      field_type: "short_text",
      required: false,
      options: [],
      page_index: 0,
    });
  }

  return fields;
}
