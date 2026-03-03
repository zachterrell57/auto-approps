import mammoth from "mammoth";
import * as cheerio from "cheerio";
import type { DocChunk, ParsedDocument } from "./models.js";

/**
 * Parse a .docx file buffer into a structured ParsedDocument.
 *
 * Uses mammoth to convert the docx to HTML, then cheerio to walk the HTML
 * in document order:
 *   - Headings (h1-h6) become "heading" chunks
 *   - Paragraphs (p)   become "paragraph" chunks
 *   - Table rows (tr)  become "table_row" chunks, with the first row treated
 *     as headers and subsequent rows formatted as "header: cell" pairs.
 */
export async function parseDocx(
  fileBuffer: Buffer,
  filename: string,
): Promise<ParsedDocument> {
  const result = await mammoth.convertToHtml({ buffer: fileBuffer });
  const $ = cheerio.load(result.value);

  const chunks: DocChunk[] = [];
  const fullTextParts: string[] = [];
  let currentHeading = "";
  let chunkIndex = 0;

  // Walk top-level body children in document order so headings, paragraphs,
  // and tables are encountered in their original sequence.
  $("body")
    .children()
    .each((_i, el) => {
      const tagName = ((el as any).tagName ?? (el as any).name ?? "").toLowerCase();

      // ── Headings ──────────────────────────────────────────────────────
      const headingMatch = tagName.match(/^h([1-6])$/);
      if (headingMatch) {
        const text = $(el).text().trim();
        if (!text) return;

        const headingLevel = parseInt(headingMatch[1], 10);
        currentHeading = text;

        const sourceLocation = `Heading: '${text}'`;
        fullTextParts.push(`\n## ${text}\n`);

        chunks.push({
          text,
          source_location: sourceLocation,
          chunk_type: "heading",
          heading_context: currentHeading,
          heading_level: headingLevel,
          index: chunkIndex,
        });
        chunkIndex++;
        return;
      }

      // ── Paragraphs ───────────────────────────────────────────────────
      if (tagName === "p") {
        const text = $(el).text().trim();
        if (!text) return;

        const sourceLocation = currentHeading
          ? `Section '${currentHeading}' > Paragraph ${chunkIndex + 1}`
          : `Paragraph ${chunkIndex + 1}`;

        fullTextParts.push(text);

        chunks.push({
          text,
          source_location: sourceLocation,
          chunk_type: "paragraph",
          heading_context: currentHeading,
          heading_level: 0,
          index: chunkIndex,
        });
        chunkIndex++;
        return;
      }

      // ── Tables ────────────────────────────────────────────────────────
      if (tagName === "table") {
        const rows = $(el).find("tr");
        if (rows.length === 0) return;

        // Extract header cells from the first row.
        const headers: string[] = [];
        rows
          .first()
          .find("td, th")
          .each((_j, cell) => {
            headers.push($(cell).text().trim());
          });

        rows.each((rowIdx, row) => {
          const cells: string[] = [];
          $(row)
            .find("td, th")
            .each((_j, cell) => {
              cells.push($(cell).text().trim());
            });

          let rowText: string;

          if (rowIdx === 0) {
            // Header row – plain pipe-delimited
            rowText = cells.join(" | ");
            fullTextParts.push(rowText);
            fullTextParts.push("-".repeat(rowText.length));
          } else {
            // Data rows – pair with headers when available
            if (headers.length > 0) {
              const pairs: string[] = [];
              for (let k = 0; k < cells.length; k++) {
                if (cells[k]) {
                  const header = k < headers.length ? headers[k] : `Col${k + 1}`;
                  pairs.push(`${header}: ${cells[k]}`);
                }
              }
              rowText = pairs.join(" | ");
            } else {
              rowText = cells.join(" | ");
            }
            fullTextParts.push(rowText);
          }

          const sourceLocation = currentHeading
            ? `Section '${currentHeading}' > Table Row ${rowIdx + 1}`
            : `Table Row ${rowIdx + 1}`;

          chunks.push({
            text: rowIdx === 0 ? cells.join(" | ") : rowText,
            source_location: sourceLocation,
            chunk_type: "table_row",
            heading_context: currentHeading,
            heading_level: 0,
            index: chunkIndex,
          });
          chunkIndex++;
        });
      }
    });

  return {
    filename,
    chunks,
    full_text: fullTextParts.join("\n"),
  };
}
