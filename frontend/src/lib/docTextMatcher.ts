import type { DocChunk } from "./types";

const TEXT_ELEMENT_SELECTORS = [
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "td", "th", "li", "span",
].join(", ");

/**
 * Normalize text for comparison: collapse whitespace,
 * normalize smart quotes/dashes/non-breaking spaces, lowercase, trim.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/[\u00A0\u2002\u2003\u2009]/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface MatchResult {
  chunk: DocChunk;
  elements: HTMLElement[];
}

function matchTableChunk(
  container: HTMLElement,
  chunk: DocChunk,
): HTMLElement[] {
  const cells = chunk.text
    .split("|")
    .map((c) => normalizeText(c))
    .filter((c) => c.length > 2);

  if (cells.length === 0) return [];

  const tables = Array.from(container.querySelectorAll<HTMLElement>("table"));
  for (const table of tables) {
    const tableText = normalizeText(table.textContent ?? "");
    const matchCount = cells.filter((cell) => tableText.includes(cell)).length;
    if (matchCount >= Math.ceil(cells.length * 0.6)) {
      return [table];
    }
  }
  return [];
}

/**
 * For each source chunk, find DOM elements in `container` whose
 * normalized text matches the chunk text.
 */
export function findChunkElements(
  container: HTMLElement,
  chunks: DocChunk[],
): MatchResult[] {
  const allElements = Array.from(
    container.querySelectorAll<HTMLElement>(TEXT_ELEMENT_SELECTORS),
  );

  const elementTexts = allElements.map((el) =>
    normalizeText(el.textContent ?? ""),
  );

  return chunks.map((chunk) => {
    if (chunk.chunk_type === "table_row") {
      return { chunk, elements: matchTableChunk(container, chunk) };
    }

    const normalizedChunk = normalizeText(chunk.text);
    if (!normalizedChunk) return { chunk, elements: [] };

    const matched: HTMLElement[] = [];
    const isShort = normalizedChunk.length < 20;
    const prefix =
      normalizedChunk.length > 80 ? normalizedChunk.slice(0, 60) : null;

    for (let i = 0; i < allElements.length; i++) {
      const elText = elementTexts[i];
      if (!elText) continue;

      if (elText.includes(normalizedChunk)) {
        if (isShort && elText.length > normalizedChunk.length * 5) {
          continue;
        }
        matched.push(allElements[i]);
      } else if (prefix && elText.includes(prefix)) {
        matched.push(allElements[i]);
      }
    }

    return { chunk, elements: matched };
  });
}
