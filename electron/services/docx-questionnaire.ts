import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { FieldMapping, FormField, TargetSchema } from "./models.js";
import { buildField, dedupeFields, inferFieldType, normalizeWhitespace, splitMultiSelectAnswer, stripExtension } from "./target-utils.js";

const WORD_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const BLANK_PATTERN = /(?:_{3,}|\.{3,}|(\[\s*\])|(\(\s*\)))/;
const OPTION_PATTERN =
  /^\s*(?:[\[_( ]?[xX ]?[\]_) ]|[_-]{1,5}|\u2610|\u2611|\u25a1|\u25a3)\s+(.+)$/;
const CHECK_HEADER_PATTERN = /\bcheck\s+(one|only one|all|both)\b/i;
const QUESTION_PATTERN = /^\s*(\d+)[.)]\s*(.+)$/;
const COLON_PATTERN = /^\s*([^:]{2,120}):\s*(.*)$/;

type XmlDocument = any;
type XmlElement = any;
type XmlNode = any;

interface ParagraphTextNode {
  textNodeIndex: number;
  text: string;
}

interface ParagraphInfo {
  paragraphIndex: number;
  element: XmlElement;
  text: string;
  textNodes: ParagraphTextNode[];
  isEmpty: boolean;
}

interface TableInfo {
  tableIndex: number;
  element: XmlElement;
  rows: Array<{
    rowIndex: number;
    cellElements: XmlElement[];
    cellTexts: string[];
  }>;
}

type Block =
  | { kind: "paragraph"; info: ParagraphInfo }
  | { kind: "table"; info: TableInfo };

interface ChoiceOption {
  label: string;
  paragraphIndex: number;
  textNodeIndex: number;
}

interface PendingQuestion {
  label: string;
  pageIndex: number;
  fieldCount: number;
  anchorParagraphIndex: number | null;
}

function isElementNode(node: XmlNode | null): node is XmlElement {
  return Boolean(node && node.nodeType === 1);
}

function isWordElement(node: XmlNode | null, localName: string): node is XmlElement {
  return isElementNode(node) && (node.localName === localName || node.nodeName === `w:${localName}`);
}

function childElements(node: XmlElement): XmlElement[] {
  const children: XmlElement[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (isElementNode(child)) children.push(child);
  }
  return children;
}

function descendantsByLocalName(root: XmlElement, localName: string): XmlElement[] {
  const matches: XmlElement[] = [];
  const visit = (node: XmlElement) => {
    for (const child of childElements(node)) {
      if (child.localName === localName || child.nodeName === `w:${localName}`) {
        matches.push(child);
      }
      visit(child);
    }
  };
  visit(root);
  return matches;
}

function paragraphInfo(element: XmlElement, paragraphIndex: number): ParagraphInfo {
  const textNodes = descendantsByLocalName(element, "t").map((textNode, index) => ({
    textNodeIndex: index,
    text: textNode.textContent ?? "",
  }));
  const text = normalizeWhitespace(textNodes.map((item) => item.text).join(""));
  return {
    paragraphIndex,
    element,
    text,
    textNodes,
    isEmpty: text.length === 0,
  };
}

function cellText(cell: XmlElement): string {
  return normalizeWhitespace(
    descendantsByLocalName(cell, "t")
      .map((node) => node.textContent ?? "")
      .join(" "),
  );
}

function tableInfo(element: XmlElement, tableIndex: number): TableInfo {
  const rows = childElements(element)
    .filter((child) => isWordElement(child, "tr"))
    .map((row, rowIndex) => {
      const cellElements = childElements(row).filter((child) => isWordElement(child, "tc"));
      return {
        rowIndex,
        cellElements,
        cellTexts: cellElements.map((cell) => cellText(cell)),
      };
    });
  return { tableIndex, element, rows };
}

function collectBlocks(documentEl: XmlElement): Block[] {
  const body = childElements(documentEl).find((child) => isWordElement(child, "body"));
  if (!body) return [];

  const blocks: Block[] = [];
  let paragraphIndex = 0;
  let tableIndex = 0;
  for (const child of childElements(body)) {
    if (isWordElement(child, "p")) {
      blocks.push({ kind: "paragraph", info: paragraphInfo(child, paragraphIndex) });
      paragraphIndex += 1;
      continue;
    }
    if (isWordElement(child, "tbl")) {
      blocks.push({ kind: "table", info: tableInfo(child, tableIndex) });
      tableIndex += 1;
    }
  }
  return blocks;
}

function findTextNodeIndexContainingBlank(paragraph: ParagraphInfo): number | null {
  for (const textNode of paragraph.textNodes) {
    if (BLANK_PATTERN.test(textNode.text)) return textNode.textNodeIndex;
  }
  return null;
}

function cleanQuestionLabel(value: string): string {
  return normalizeWhitespace(value.replace(QUESTION_PATTERN, "$2").replace(/\s*\([^)]*\)\s*$/, ""));
}

function combineQuestionContext(questionLabel: string | null, label: string): string {
  const normalizedLabel = normalizeWhitespace(label.replace(/[:\s]+$/, ""));
  if (!questionLabel) return normalizedLabel;
  const normalizedQuestion = normalizeWhitespace(questionLabel.replace(/[:\s]+$/, ""));
  if (!normalizedLabel) return normalizedQuestion;
  if (normalizedQuestion.toLowerCase().includes(normalizedLabel.toLowerCase())) {
    return normalizedLabel;
  }
  return normalizedLabel;
}

function parseParagraphBlankField(
  paragraph: ParagraphInfo,
  questionLabel: string | null,
  fieldIndex: number,
): FormField | null {
  const textNodeIndex = findTextNodeIndexContainingBlank(paragraph);
  if (textNodeIndex === null) return null;
  const label = paragraph.text.replace(BLANK_PATTERN, "").replace(/\s+/g, " ").trim();
  const finalLabel = combineQuestionContext(questionLabel, label || questionLabel || "Response");
  if (!finalLabel) return null;
  return buildField(
    {
      label: finalLabel,
      fieldType: inferFieldType(finalLabel),
      pageIndex: 0,
      exportable: true,
      locator: {
        kind: "paragraph_blank",
        paragraphIndex: paragraph.paragraphIndex,
        textNodeIndex,
      },
    },
    fieldIndex,
  );
}

function parseColonField(
  paragraph: ParagraphInfo,
  questionLabel: string | null,
  fieldIndex: number,
): FormField | null {
  const match = paragraph.text.match(COLON_PATTERN);
  if (!match) return null;
  const [, labelPart, valuePart] = match;
  const label = combineQuestionContext(questionLabel, labelPart);
  if (!label) return null;

  if (BLANK_PATTERN.test(valuePart)) {
    return parseParagraphBlankField(paragraph, questionLabel, fieldIndex);
  }

  if (valuePart.trim()) {
    return null;
  }

  return buildField(
    {
      label,
      fieldType: inferFieldType(label),
      pageIndex: 0,
      exportable: false,
      exportIssue: "No anchored answer region detected in the DOCX template.",
      locator: null,
    },
    fieldIndex,
  );
}

function parseChoiceOption(paragraph: ParagraphInfo): ChoiceOption | null {
  const match = paragraph.text.match(OPTION_PATTERN);
  if (!match) return null;
  const label = normalizeWhitespace(match[1]);
  if (!label) return null;

  const textNodeIndex = paragraph.textNodes.length > 0 ? 0 : null;
  if (textNodeIndex === null) return null;

  return {
    label,
    paragraphIndex: paragraph.paragraphIndex,
    textNodeIndex,
  };
}

function rowLooksLikeTableHeader(cellTexts: string[]): boolean {
  if (cellTexts.length < 2) return false;
  return cellTexts.every((value) => value.length > 0);
}

function isBlankCell(value: string): boolean {
  return !normalizeWhitespace(value) || BLANK_PATTERN.test(value);
}

function parseTableFields(
  table: TableInfo,
  questionLabel: string | null,
  nextFieldIndex: number,
): FormField[] {
  if (table.rows.length === 0) return [];

  const headerRow = rowLooksLikeTableHeader(table.rows[0].cellTexts)
    ? table.rows[0].cellTexts
    : null;
  const startRowIndex = headerRow ? 1 : 0;
  const fields: FormField[] = [];

  for (let rowPointer = startRowIndex; rowPointer < table.rows.length; rowPointer += 1) {
    const row = table.rows[rowPointer];
    const blankCellIndices = row.cellTexts
      .map((value, index) => (isBlankCell(value) ? index : -1))
      .filter((index) => index >= 0);

    if (blankCellIndices.length !== 1) continue;

    const blankCellIndex = blankCellIndices[0];
    const labelParts = row.cellTexts
      .map((value, index) => {
        if (index === blankCellIndex) return "";
        const header = headerRow && headerRow[index] ? `${headerRow[index]} ` : "";
        return `${header}${value}`.trim();
      })
      .filter(Boolean);
    const label = combineQuestionContext(questionLabel, labelParts.join(" - "));
    if (!label) continue;

    fields.push(
      buildField(
        {
          label,
          fieldType: inferFieldType(label),
          pageIndex: 0,
          exportable: true,
          locator: {
            kind: "table_cell",
            tableIndex: table.tableIndex,
            rowIndex: row.rowIndex,
            cellIndex: blankCellIndex,
          },
        },
        nextFieldIndex + fields.length,
      ),
    );
  }

  return fields;
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
        exportable: pendingQuestion.anchorParagraphIndex !== null,
        exportIssue:
          pendingQuestion.anchorParagraphIndex === null
            ? "No anchored answer region detected in the DOCX template."
            : "",
        locator:
          pendingQuestion.anchorParagraphIndex === null
            ? null
            : {
                kind: "paragraph_append",
                paragraphIndex: pendingQuestion.anchorParagraphIndex,
              },
      },
      fields.length,
    ),
  );
  return null;
}

export async function parseDocxQuestionnaire(
  fileBuffer: Buffer,
  filename: string,
): Promise<TargetSchema> {
  const zip = await JSZip.loadAsync(fileBuffer);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) {
    throw new Error("The DOCX file is missing word/document.xml.");
  }

  const doc = new DOMParser().parseFromString(documentXml, "text/xml");
  const blocks = collectBlocks(doc.documentElement);
  const fields: FormField[] = [];
  const parseWarnings: string[] = [];
  let pendingQuestion: PendingQuestion | null = null;
  let pendingChoiceGroup:
    | {
        label: string;
        pageIndex: number;
        multi: boolean;
        options: ChoiceOption[];
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
          options: pendingChoiceGroup.options.map((option) => option.label),
          pageIndex: pendingChoiceGroup.pageIndex,
          exportable: true,
          locator: {
            kind: "checkbox_group",
            multi: pendingChoiceGroup.multi,
            options: pendingChoiceGroup.options,
          },
        },
        fields.length,
      ),
    );
    if (pendingQuestion) pendingQuestion.fieldCount += 1;
    pendingChoiceGroup = null;
  };

  for (const block of blocks) {
    if (block.kind === "paragraph") {
      const paragraph = block.info;
      const questionMatch = paragraph.text.match(QUESTION_PATTERN);

      if (pendingChoiceGroup && !parseChoiceOption(paragraph)) {
        finalizeChoiceGroup();
      }

      if (questionMatch) {
        pendingQuestion = finalizePendingQuestion(pendingQuestion, fields);
        pendingQuestion = {
          label: cleanQuestionLabel(paragraph.text),
          pageIndex: 0,
          fieldCount: 0,
          anchorParagraphIndex: null,
        };
      }

      if (paragraph.isEmpty) {
        if (pendingQuestion && pendingQuestion.anchorParagraphIndex === null) {
          pendingQuestion.anchorParagraphIndex = paragraph.paragraphIndex;
        }
        continue;
      }

      const checkHeaderMatch = paragraph.text.match(CHECK_HEADER_PATTERN);
      if (checkHeaderMatch) {
        pendingChoiceGroup = {
          label: pendingQuestion?.label ?? paragraph.text,
          pageIndex: 0,
          multi: /check\s+(all|both)/i.test(checkHeaderMatch[0]),
          options: [],
        };
        continue;
      }

      if (pendingChoiceGroup) {
        const option = parseChoiceOption(paragraph);
        if (option) {
          pendingChoiceGroup.options.push(option);
          continue;
        }
      }

      const blankField = parseParagraphBlankField(
        paragraph,
        pendingQuestion?.label ?? null,
        fields.length,
      );
      if (blankField) {
        fields.push(blankField);
        if (pendingQuestion) pendingQuestion.fieldCount += 1;
        continue;
      }

      const colonField = parseColonField(
        paragraph,
        pendingQuestion?.label ?? null,
        fields.length,
      );
      if (colonField) {
        fields.push(colonField);
        if (pendingQuestion) pendingQuestion.fieldCount += 1;
      }
      continue;
    }

    finalizeChoiceGroup();
    const tableFields = parseTableFields(
      block.info,
      pendingQuestion?.label ?? null,
      fields.length,
    );
    if (tableFields.length > 0) {
      fields.push(...tableFields);
      if (pendingQuestion) pendingQuestion.fieldCount += tableFields.length;
      continue;
    }
    parseWarnings.push(
      `Skipped table ${block.info.tableIndex + 1}; no writable blank cells were detected.`,
    );
  }

  finalizeChoiceGroup();
  finalizePendingQuestion(pendingQuestion, fields);

  const dedupedFields = dedupeFields(fields);
  if (dedupedFields.length === 0) {
    parseWarnings.push("No questionnaire fields were detected in the DOCX file.");
  }

  const title = stripExtension(filename);
  return {
    title,
    description: "",
    fields: dedupedFields,
    page_count: 1,
    target_kind: "docx_questionnaire",
    target_url: "",
    target_filename: filename,
    target_title: title,
    target_provider: "docx",
    parse_warnings: parseWarnings,
    url: "",
    provider: "docx",
    scrape_warnings: parseWarnings,
    form_state: "open",
    form_state_message: "",
  };
}

function findParagraphsAndTables(documentEl: XmlElement): {
  paragraphs: XmlElement[];
  tables: XmlElement[];
} {
  const body = childElements(documentEl).find((child) => isWordElement(child, "body"));
  const paragraphs: XmlElement[] = [];
  const tables: XmlElement[] = [];
  if (!body) return { paragraphs, tables };

  for (const child of childElements(body)) {
    if (isWordElement(child, "p")) {
      paragraphs.push(child);
    } else if (isWordElement(child, "tbl")) {
      tables.push(child);
    }
  }
  return { paragraphs, tables };
}

function paragraphTextElements(paragraph: XmlElement): XmlElement[] {
  return descendantsByLocalName(paragraph, "t");
}

function ensureParagraphRun(doc: XmlDocument, paragraph: XmlElement): XmlElement {
  const existingRun = childElements(paragraph).find((child) => isWordElement(child, "r"));
  if (existingRun) return existingRun;
  const run = doc.createElementNS(WORD_NS, "w:r");
  paragraph.appendChild(run);
  return run;
}

function ensureTextElement(doc: XmlDocument, paragraph: XmlElement): XmlElement {
  const textElements = paragraphTextElements(paragraph);
  if (textElements.length > 0) return textElements[0];
  const run = ensureParagraphRun(doc, paragraph);
  const text = doc.createElementNS(WORD_NS, "w:t");
  text.setAttributeNS(XML_NS, "xml:space", "preserve");
  run.appendChild(text);
  return text;
}

function setParagraphText(doc: XmlDocument, paragraph: XmlElement, value: string): void {
  const normalizedValue = value.replace(/\s*\n+\s*/g, " ").trim();
  const textElements = paragraphTextElements(paragraph);
  if (textElements.length === 0) {
    ensureTextElement(doc, paragraph).textContent = normalizedValue;
    return;
  }
  textElements[0].textContent = normalizedValue;
  for (let index = 1; index < textElements.length; index += 1) {
    textElements[index].textContent = "";
  }
}

function updateBlankText(original: string, value: string): string {
  if (BLANK_PATTERN.test(original)) {
    return original.replace(BLANK_PATTERN, value);
  }
  return value;
}

function setTableCellText(doc: XmlDocument, cell: XmlElement, value: string): void {
  const paragraphs = childElements(cell).filter((child) => isWordElement(child, "p"));
  if (paragraphs.length === 0) {
    const paragraph = doc.createElementNS(WORD_NS, "w:p");
    cell.appendChild(paragraph);
    setParagraphText(doc, paragraph, value);
    return;
  }
  setParagraphText(doc, paragraphs[0], value);
}

function markOptionText(original: string, selected: boolean): string {
  if (original.includes("☐") || original.includes("☑") || original.includes("☒")) {
    return original.replace(/[☐☑☒]/g, selected ? "☒" : "☐");
  }
  if (/\[\s*[xX ]?\s*\]/.test(original)) {
    return original.replace(/\[\s*[xX ]?\s*\]/, selected ? "[X]" : "[ ]");
  }
  if (/\(\s*[xX ]?\s*\)/.test(original)) {
    return original.replace(/\(\s*[xX ]?\s*\)/, selected ? "(X)" : "( )");
  }
  return original.replace(/^\s*[_-]{1,5}/, selected ? "X" : "_");
}

export async function fillDocxQuestionnaire(
  fileBuffer: Buffer,
  targetSchema: TargetSchema,
  mappings: FieldMapping[],
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(fileBuffer);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) {
    throw new Error("The DOCX file is missing word/document.xml.");
  }

  const doc = new DOMParser().parseFromString(documentXml, "text/xml");
  const { paragraphs, tables } = findParagraphsAndTables(doc.documentElement);
  const mappingByFieldId = new Map(
    mappings.map((mapping) => [mapping.field_id, mapping] as const),
  );

  for (const field of targetSchema.fields) {
    if (!field.exportable || !field.target_locator) continue;
    const mapping = mappingByFieldId.get(field.field_id);
    const answer = mapping?.proposed_answer?.trim();
    if (!answer) continue;

    const locator = field.target_locator as Record<string, unknown>;
    const kind = String(locator.kind ?? "");

    if (kind === "paragraph_blank") {
      const paragraph = paragraphs[Number(locator.paragraphIndex)];
      if (!paragraph) continue;
      const textElements = paragraphTextElements(paragraph);
      const textElement = textElements[Number(locator.textNodeIndex)];
      if (!textElement) continue;
      textElement.textContent = updateBlankText(textElement.textContent ?? "", answer);
      continue;
    }

    if (kind === "paragraph_append") {
      const paragraph = paragraphs[Number(locator.paragraphIndex)];
      if (!paragraph) continue;
      setParagraphText(doc, paragraph, answer);
      continue;
    }

    if (kind === "table_cell") {
      const table = tables[Number(locator.tableIndex)];
      if (!table) continue;
      const rows = childElements(table).filter((child) => isWordElement(child, "tr"));
      const row = rows[Number(locator.rowIndex)];
      if (!row) continue;
      const cells = childElements(row).filter((child) => isWordElement(child, "tc"));
      const cell = cells[Number(locator.cellIndex)];
      if (!cell) continue;
      setTableCellText(doc, cell, answer);
      continue;
    }

    if (kind === "checkbox_group") {
      const multi = Boolean(locator.multi);
      const selectedValues = multi
        ? new Set(splitMultiSelectAnswer(answer).map((value) => value.toLowerCase()))
        : new Set([normalizeWhitespace(answer).toLowerCase()]);
      const options = Array.isArray(locator.options)
        ? (locator.options as Array<Record<string, unknown>>)
        : [];

      for (const option of options) {
        const paragraph = paragraphs[Number(option.paragraphIndex)];
        if (!paragraph) continue;
        const textElements = paragraphTextElements(paragraph);
        const textElement = textElements[Number(option.textNodeIndex)];
        if (!textElement) continue;
        const optionLabel = normalizeWhitespace(String(option.label ?? "")).toLowerCase();
        const isSelected = selectedValues.has(optionLabel);
        textElement.textContent = markOptionText(textElement.textContent ?? "", isSelected);
      }
    }
  }

  const serializer = new XMLSerializer();
  zip.file("word/document.xml", serializer.serializeToString(doc));
  return zip.generateAsync({ type: "nodebuffer" });
}
