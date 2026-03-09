import type { FormField, TargetSchema } from "./models.js";
import {
  buildField,
  dedupeFields,
  inferFieldType,
  normalizeWhitespace,
  stripExtension,
} from "./target-utils.js";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfJsWorkerModule = typeof import("pdfjs-dist/legacy/build/pdf.worker.mjs");

const QUESTION_PATTERN = /^\s*(\d+)[.)]\s*(.+)$/;
const CHECK_HEADER_PATTERN = /\bcheck\s+(one|only one|all|both)\b/i;
const OPTION_PATTERN =
  /^\s*(?:[\[_( ]?[xX ]?[\]_) ]|[_-]{1,5}|\u2610|\u2611|\u25a1|\u25a3)\s+(.+)$/;
const COLON_PATTERN = /^\s*([^:]{2,120}):\s*(.*)$/;

declare global {
  // PDF.js fake-worker mode looks for this global before attempting a relative import.
  var pdfjsWorker: PdfJsWorkerModule | undefined;
}

interface PdfLine {
  pageIndex: number;
  y: number;
  text: string;
}

interface PendingQuestion {
  label: string;
  pageIndex: number;
  fieldCount: number;
}

function lineLooksBlank(value: string): boolean {
  return normalizeWhitespace(value).length === 0;
}

function cleanQuestionLabel(value: string): string {
  return normalizeWhitespace(value.replace(QUESTION_PATTERN, "$2"));
}

function combineQuestionContext(questionLabel: string | null, label: string): string {
  const normalizedLabel = normalizeWhitespace(label.replace(/[:\s]+$/, ""));
  if (!questionLabel) return normalizedLabel;
  if (!normalizedLabel) return normalizeWhitespace(questionLabel);
  if (questionLabel.toLowerCase().includes(normalizedLabel.toLowerCase())) {
    return normalizedLabel;
  }
  return normalizedLabel;
}

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;
let pdfJsWorkerPromise: Promise<void> | null = null;

async function loadPdfJsModule(): Promise<PdfJsModule> {
  pdfJsModulePromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfJsWorkerPromise ??= (async () => {
    if (!globalThis.pdfjsWorker) {
      globalThis.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    }
  })();

  const [pdfjs] = await Promise.all([pdfJsModulePromise, pdfJsWorkerPromise]);
  return pdfjs;
}

async function loadPdfTextLines(fileBuffer: Buffer): Promise<PdfLine[]> {
  const pdfjs = await loadPdfJsModule();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(fileBuffer),
    disableFontFace: true,
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const lines: PdfLine[] = [];

  for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex + 1);
    const textContent = await page.getTextContent();
    const items = (textContent.items as Array<{
      str?: string;
      transform?: number[];
    }>).filter((item) => normalizeWhitespace(item.str ?? "").length > 0);

    const grouped = new Map<number, Array<{ x: number; text: string }>>();
    for (const item of items) {
      const text = normalizeWhitespace(item.str ?? "");
      const transform = item.transform ?? [0, 0, 0, 0, 0, 0];
      const x = transform[4] ?? 0;
      const y = Math.round((transform[5] ?? 0) * 2) / 2;
      const bucketKey = Number(y.toFixed(1));
      const bucket = grouped.get(bucketKey) ?? [];
      bucket.push({ x, text });
      grouped.set(bucketKey, bucket);
    }

    const pageLines = [...grouped.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([y, bucket]) => ({
        pageIndex,
        y,
        text: normalizeWhitespace(
          bucket
            .sort((left, right) => left.x - right.x)
            .map((item) => item.text)
            .join(" "),
        ),
      }))
      .filter((line) => line.text.length > 0);

    lines.push(...pageLines);
  }

  return lines;
}

function finalizePendingQuestion(
  pendingQuestion: PendingQuestion | null,
  fields: FormField[],
): PendingQuestion | null {
  if (!pendingQuestion) return null;
  if (pendingQuestion.fieldCount > 0) return null;

  fields.push(
    buildField(
      {
        label: pendingQuestion.label,
        fieldType: inferFieldType(pendingQuestion.label, "long_text"),
        pageIndex: pendingQuestion.pageIndex,
        exportable: false,
        exportIssue: "PDF questionnaire export is not supported in this version.",
      },
      fields.length,
    ),
  );

  return null;
}

export async function parsePdfQuestionnaire(
  fileBuffer: Buffer,
  filename: string,
): Promise<TargetSchema> {
  const lines = await loadPdfTextLines(fileBuffer);
  const fields: FormField[] = [];
  const parseWarnings: string[] = [];
  let pendingQuestion: PendingQuestion | null = null;
  let pendingChoiceGroup:
    | {
        label: string;
        pageIndex: number;
        multi: boolean;
        options: string[];
      }
    | null = null;

  const finalizeChoiceGroup = () => {
    if (!pendingChoiceGroup) return;
    if (pendingChoiceGroup.options.length === 0) {
      parseWarnings.push(
        `Choice group "${pendingChoiceGroup.label}" was detected without recognizable options.`,
      );
      pendingChoiceGroup = null;
      return;
    }

    fields.push(
      buildField(
        {
          label: pendingChoiceGroup.label,
          fieldType: pendingChoiceGroup.multi ? "checkbox" : "radio",
          options: pendingChoiceGroup.options,
          pageIndex: pendingChoiceGroup.pageIndex,
          exportable: false,
          exportIssue: "PDF questionnaire export is not supported in this version.",
        },
        fields.length,
      ),
    );
    if (pendingQuestion) pendingQuestion.fieldCount += 1;
    pendingChoiceGroup = null;
  };

  for (const line of lines) {
    if (lineLooksBlank(line.text)) continue;

    if (pendingChoiceGroup && !OPTION_PATTERN.test(line.text)) {
      finalizeChoiceGroup();
    }

    const questionMatch = line.text.match(QUESTION_PATTERN);
    if (questionMatch) {
      pendingQuestion = finalizePendingQuestion(pendingQuestion, fields);
      pendingQuestion = {
        label: cleanQuestionLabel(line.text),
        pageIndex: line.pageIndex,
        fieldCount: 0,
      };
    }

    const checkHeaderMatch = line.text.match(CHECK_HEADER_PATTERN);
    if (checkHeaderMatch) {
      pendingChoiceGroup = {
        label: pendingQuestion?.label ?? normalizeWhitespace(line.text),
        pageIndex: line.pageIndex,
        multi: /check\s+(all|both)/i.test(checkHeaderMatch[0]),
        options: [],
      };
      continue;
    }

    if (pendingChoiceGroup) {
      const optionMatch = line.text.match(OPTION_PATTERN);
      if (optionMatch) {
        pendingChoiceGroup.options.push(normalizeWhitespace(optionMatch[1]));
        continue;
      }
    }

    const colonMatch = line.text.match(COLON_PATTERN);
    if (colonMatch) {
      const [, labelPart, valuePart] = colonMatch;
      const value = normalizeWhitespace(valuePart);
      if (!value || /^[_.-]{2,}$/.test(value)) {
        fields.push(
          buildField(
            {
              label: combineQuestionContext(pendingQuestion?.label ?? null, labelPart),
              fieldType: inferFieldType(labelPart),
              pageIndex: line.pageIndex,
              exportable: false,
              exportIssue: "PDF questionnaire export is not supported in this version.",
            },
            fields.length,
          ),
        );
        if (pendingQuestion) pendingQuestion.fieldCount += 1;
      }
    }
  }

  finalizeChoiceGroup();
  finalizePendingQuestion(pendingQuestion, fields);

  const dedupedFields = dedupeFields(fields);
  if (dedupedFields.length === 0) {
    parseWarnings.push(
      "No questionnaire fields were detected. This parser supports text-based PDFs only.",
    );
  }

  const title = stripExtension(filename);
  return {
    title,
    description: "",
    fields: dedupedFields,
    page_count: Math.max(1, ...lines.map((line) => line.pageIndex + 1), 1),
    target_kind: "pdf_questionnaire",
    target_url: "",
    target_filename: filename,
    target_title: title,
    target_provider: "pdf",
    parse_warnings: parseWarnings,
    url: "",
    provider: "pdf",
    scrape_warnings: parseWarnings,
    form_state: "open",
    form_state_message: "",
  };
}
