import JSZip from "jszip";

import {
  HearingExportFormatEnum,
  type HearingExportFormat,
  type HearingExportResult,
  type HearingOutput,
  type HearingWorkspace,
} from "./hearing-models";
import { markHearingExported } from "./hearing-store";
import { formatMs } from "./hearing-transcript";

function safeFilename(value: string): string {
  const cleaned = value
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || "hearing";
}

function encode(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeCsv(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function selectedOutput(
  workspace: HearingWorkspace,
  outputId?: string,
): HearingOutput | null {
  if (outputId) {
    return workspace.outputs.find((output) => output.id === outputId) ?? null;
  }
  return workspace.outputs[0] ?? null;
}

function markdownPackage(workspace: HearingWorkspace, output: HearingOutput | null): string {
  const header = [
    `Client: ${workspace.job.client_name || "None configured"}`,
    `Hearing: ${workspace.job.hearing_title || "Untitled hearing"}`,
    `Committee: ${workspace.job.committee || "Unknown committee"}`,
    `Source: ${workspace.job.source_url}`,
    `Generated: ${new Date().toISOString()}`,
    `Review status: ${output?.review_status ?? workspace.job.status}`,
  ].join("\n");
  return `${header}\n\n${output?.content_markdown ?? "No generated output is available."}`;
}

function htmlPackage(workspace: HearingWorkspace, output: HearingOutput | null): string {
  const md = markdownPackage(workspace, output);
  const lines = md.split("\n");
  const body = lines
    .map((line) => {
      if (line.startsWith("# ")) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
      if (line.startsWith("## ")) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
      if (line.startsWith("- ")) return `<li>${escapeHtml(line.slice(2))}</li>`;
      if (!line.trim()) return "";
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join("\n")
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(workspace.job.hearing_title || "Hearing memo")}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #171717; margin: 48px; line-height: 1.55; }
    h1 { font-size: 28px; margin: 0 0 20px; }
    h2 { font-size: 18px; margin: 28px 0 8px; border-top: 1px solid #ddd; padding-top: 16px; }
    p, li { font-size: 13px; }
    ul { padding-left: 20px; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function mentionLogCsv(workspace: HearingWorkspace): string {
  const rows = [
    [
      "hit_id",
      "watch_item_id",
      "trigger_text",
      "match_type",
      "confidence",
      "start",
      "end",
      "speakers",
      "segment_ids",
      "client_relevance",
      "status",
    ],
    ...workspace.watch_hits.map((hit) => [
      hit.hitId,
      hit.watchItemId,
      hit.triggerText,
      hit.matchType,
      String(hit.confidence),
      formatMs(hit.startMs),
      formatMs(hit.endMs),
      hit.speakerLabels.join("; "),
      hit.transcriptSegmentIds.join("; "),
      hit.clientRelevance,
      hit.status,
    ]),
  ];
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function transcriptPackage(workspace: HearingWorkspace): string {
  return workspace.transcript_segments
    .map(
      (segment) =>
        `[${formatMs(segment.startMs)}-${formatMs(segment.endMs)}] ${segment.speakerLabel} (${segment.reviewStatus}, ASR ${Math.round(segment.asrConfidence * 100)}%, speaker ${Math.round(segment.speakerConfidence * 100)}%): ${segment.text}`,
    )
    .join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function docxPackage(workspace: HearingWorkspace, output: HearingOutput | null): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const paragraphs = markdownPackage(workspace, output)
    .split("\n")
    .map((line) => {
      const isHeading = line.startsWith("#");
      const text = line.replace(/^#+\s*/, "");
      if (!text.trim()) return "<w:p/>";
      const style = isHeading ? "<w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr>" : "";
      return `<w:p>${style}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
    })
    .join("");
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
  );
  zip.folder("_rels")?.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.folder("word")?.file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`,
  );
  zip.folder("word")?.file(
    "styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
</w:styles>`,
  );
  return zip.generateAsync({ type: "arraybuffer" });
}

function pdfEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function simplePdf(text: string): ArrayBuffer {
  const pageWidth = 612;
  const pageHeight = 792;
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/);
    let current = "";
    for (const word of words) {
      if ((current + " " + word).trim().length > 88) {
        lines.push(current);
        current = word;
      } else {
        current = `${current} ${word}`.trim();
      }
    }
    lines.push(current);
  }
  const pages: string[][] = [];
  for (let idx = 0; idx < lines.length; idx += 48) {
    pages.push(lines.slice(idx, idx + 48));
  }
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${pages.map((_page, idx) => `${3 + idx * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  pages.forEach((pageLines, idx) => {
    const pageObj = 3 + idx * 2;
    const contentObj = pageObj + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${contentObj} 0 R >>`);
    const content = [
      "BT",
      "/F1 10 Tf",
      "50 742 Td",
      ...pageLines.map((line, lineIdx) =>
        `${lineIdx === 0 ? "" : "0 -14 Td " }(${pdfEscape(line)}) Tj`,
      ),
      "ET",
    ].join("\n");
    objects.push(`<< /Length ${Buffer.byteLength(content, "utf-8")} >>\nstream\n${content}\nendstream`);
  });
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, idx) => {
    offsets.push(Buffer.byteLength(pdf, "utf-8"));
    pdf += `${idx + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "utf-8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let idx = 1; idx < offsets.length; idx++) {
    pdf += `${String(offsets[idx]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return encode(pdf);
}

export async function exportHearingWorkspace(args: {
  workspace: HearingWorkspace;
  format: HearingExportFormat;
  outputId?: string;
}): Promise<HearingExportResult> {
  const format = HearingExportFormatEnum.parse(args.format);
  const output = selectedOutput(args.workspace, args.outputId);
  const memoFormat = ["markdown", "html", "email", "docx", "pdf"].includes(format);
  if (
    memoFormat &&
    output &&
    output.review_status !== "verified" &&
    process.env.HEARING_ALLOW_UNREVIEWED_EXPORTS !== "true"
  ) {
    throw new Error("Verify the memo before exporting a client-ready package.");
  }
  const base = safeFilename(
    `${args.workspace.job.client_name || "hearing"}-${args.workspace.job.hearing_title || "hearing"}`,
  );
  let result: HearingExportResult;

  if (format === "markdown") {
    result = {
      buffer: encode(markdownPackage(args.workspace, output)),
      filename: `${base}.md`,
      mime_type: "text/markdown",
    };
  } else if (format === "html" || format === "email") {
    result = {
      buffer: encode(htmlPackage(args.workspace, output)),
      filename: `${base}.${format === "email" ? "email" : "html"}`,
      mime_type: "text/html",
    };
  } else if (format === "csv") {
    result = {
      buffer: encode(mentionLogCsv(args.workspace)),
      filename: `${base}-mention-log.csv`,
      mime_type: "text/csv",
    };
  } else if (format === "json") {
    result = {
      buffer: encode(JSON.stringify(args.workspace, null, 2)),
      filename: `${base}.json`,
      mime_type: "application/json",
    };
  } else if (format === "transcript") {
    result = {
      buffer: encode(transcriptPackage(args.workspace)),
      filename: `${base}-transcript.txt`,
      mime_type: "text/plain",
    };
  } else if (format === "docx") {
    result = {
      buffer: await docxPackage(args.workspace, output),
      filename: `${base}.docx`,
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  } else {
    result = {
      buffer: simplePdf(markdownPackage(args.workspace, output)),
      filename: `${base}.pdf`,
      mime_type: "application/pdf",
    };
  }

  markHearingExported(args.workspace.job.id, format, output?.id);
  return result;
}
