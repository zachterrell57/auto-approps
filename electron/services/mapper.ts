// ---------------------------------------------------------------------------
// mapper.ts — AI-powered field mapping via Claude tool-use
//
// Uses the Anthropic Node SDK (async by default) and fastest-levenshtein
// for fuzzy string matching.
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import { distance } from "fastest-levenshtein";

import { getAnthropicClient } from "./anthropic-client";
import { apiSemaphore } from "./concurrency";
import { settings } from "./config";
import type {
  DocChunk,
  FieldMapping,
  FormField,
  FormSchema,
  KnowledgeProfile,
  MappingResult,
  ParsedDocument,
} from "./models";
import { knowledgeProfileHasContent } from "./models";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert at congressional appropriations and government forms.

Your task: given available evidence sources and a form schema, map the best-supported answers to form fields.

Rules:
1. For each form field, find the best matching content from the provided evidence.
2. For radio/dropdown/checkbox fields, your answer MUST exactly match one of the provided options.
3. Include a source citation for each answer — reference the specific section/paragraph/table row.
4. Rate your confidence: "high" (exact match found), "medium" (inferred from context), "low" (guessing).
5. For number fields, preserve exact precision from the source evidence.
6. If no relevant content exists for a field, leave proposed_answer empty and set confidence to "low".
7. Include brief reasoning for each mapping.
8. You MUST call the provided tool exactly once.
9. Source precedence is strict: Document > Client Knowledge > User/Firm Profile.
10. If sources conflict, choose the highest-priority source and explain briefly.
11. For source_chunk_indices, include the integer index of every document chunk you used (from the [Chunk N] markers). Use an empty array if no document chunks were referenced.
12. Do not invent client-specific details.
13. If an answer is derived mainly from reusable profile context, set source_citation to "User/Firm Profile".
14. If an answer is derived mainly from client knowledge, set source_citation to "Client Knowledge".
15. Keep reasoning and source_citation concise — one sentence each.
`;

const _TOOL_NAME = "submit_field_mappings";

// ---------------------------------------------------------------------------
// Fuzzy matching helper (replaces difflib.get_close_matches)
// ---------------------------------------------------------------------------

/**
 * Return up to `n` items from `possibilities` that are sufficiently close to
 * `word`, sorted best-first.  Uses Levenshtein distance converted to a 0-1
 * similarity ratio.
 */
function getCloseMatches(
  word: string,
  possibilities: string[],
  n: number,
  cutoff: number,
): string[] {
  const scored = possibilities
    .map((p) => ({
      p,
      ratio:
        1 - distance(word, p) / Math.max(word.length, p.length, 1),
    }))
    .filter((x) => x.ratio >= cutoff)
    .sort((a, b) => b.ratio - a.ratio);
  return scored.slice(0, n).map((x) => x.p);
}

// ---------------------------------------------------------------------------
// Alias helpers
// ---------------------------------------------------------------------------

function _fieldAlias(index: number): string {
  return `F${String(index + 1).padStart(3, "0")}`;
}

function _buildAliasMaps(
  fields: FormField[],
): { aliasToFieldId: Record<string, string>; fieldIdToAlias: Record<string, string> } {
  const aliasToFieldId: Record<string, string> = {};
  const fieldIdToAlias: Record<string, string> = {};
  for (let idx = 0; idx < fields.length; idx++) {
    const alias = _fieldAlias(idx);
    aliasToFieldId[alias] = fields[idx].field_id;
    fieldIdToAlias[fields[idx].field_id] = alias;
  }
  return { aliasToFieldId, fieldIdToAlias };
}

// ---------------------------------------------------------------------------
// Label normalisation
// ---------------------------------------------------------------------------

function _normalizeLabel(value: string): string {
  return value.toLowerCase().trim().split(/\s+/).join(" ");
}

// ---------------------------------------------------------------------------
// User message builder
// ---------------------------------------------------------------------------

export function buildUserMessage(
  doc: ParsedDocument | null,
  form: FormSchema,
  fieldIdToAlias: Record<string, string>,
  knowledgeProfile?: KnowledgeProfile | null,
  clientKnowledge?: string | null,
): string {
  const docChunks = doc?.chunks ?? [];
  const parts: string[] = [
    "## Evidence Priority\n",
    "1) Document\n2) Client Knowledge\n3) User/Firm Profile\n",
  ];

  if (docChunks.length > 0) {
    parts.push("## Document Content\n");
    for (const chunk of docChunks) {
      parts.push(
        `[Chunk ${chunk.index}, Source: ${chunk.source_location}]\n${chunk.text}\n`,
      );
    }
  } else {
    parts.push("## Document Content\nNo uploaded document was provided.\n");
  }

  if (clientKnowledge && clientKnowledge.trim()) {
    parts.push("\n## Client Knowledge\n");
    parts.push(
      "Middle-priority source. Use after document evidence and before User/Firm profile context.",
    );
    parts.push(`\n[Client Knowledge]\n${clientKnowledge.trim()}\n`);
  }

  if (knowledgeProfile && knowledgeProfileHasContent(knowledgeProfile)) {
    parts.push("\n## Reusable User/Firm Context\n");
    parts.push(
      "Lowest-priority source. Use only to fill gaps not covered by document or client knowledge.",
    );
    if (knowledgeProfile.user_context.trim()) {
      parts.push(
        `\n[User Knowledge]\n${knowledgeProfile.user_context.trim()}\n`,
      );
    }
    if (knowledgeProfile.firm_context.trim()) {
      parts.push(
        `\n[Firm Knowledge]\n${knowledgeProfile.firm_context.trim()}\n`,
      );
    }
  }

  parts.push("\n## Form Fields\n");
  for (const field of form.fields) {
    const alias = fieldIdToAlias[field.field_id] ?? "";
    let desc = `- **${field.label}** (Key: ${alias}, ID: ${field.field_id}, Type: ${field.field_type}`;
    if (field.required) {
      desc += ", Required";
    }
    if (field.options && field.options.length > 0) {
      desc += `, Options: ${JSON.stringify(field.options)}`;
    }
    desc += ")";
    parts.push(desc);
  }

  parts.push("\n\nReturn mappings for the listed field IDs only.");
  parts.push(
    "Use unmapped_fields only for known form field IDs that truly have no supporting content.",
  );
  parts.push(
    "For field_id, prefer the short Key value (for example F001). " +
      "Exact original ID values are also accepted.",
  );

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Tool schema sent to Claude
// ---------------------------------------------------------------------------

const MAPPING_SCHEMA: Anthropic.Tool.InputSchema = {
  type: "object" as const,
  properties: {
    mappings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field_id: { type: "string" },
          field_label: { type: "string" },
          proposed_answer: { type: "string" },
          source_citation: { type: "string" },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
          reasoning: { type: "string" },
          source_chunk_indices: {
            type: "array",
            items: { type: "integer" },
            description:
              "Indices of the document chunks referenced (from [Chunk N] markers).",
          },
        },
        required: [
          "field_id",
          "field_label",
          "proposed_answer",
          "source_citation",
          "confidence",
          "reasoning",
          "source_chunk_indices",
        ],
        additionalProperties: false,
      },
    },
    unmapped_fields: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["mappings", "unmapped_fields"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Raw mapping payload types (from Claude tool output)
// ---------------------------------------------------------------------------

interface RawMapping {
  field_id?: string;
  field_label?: string;
  proposed_answer?: string;
  source_citation?: string;
  confidence?: string;
  reasoning?: string;
  source_chunk_indices?: number[];
  [key: string]: unknown;
}

interface RawMappingPayload {
  mappings?: RawMapping[];
  unmapped_fields?: string[];
}

// ---------------------------------------------------------------------------
// Request mapping from Claude
// ---------------------------------------------------------------------------

async function _requestMappingPayload(
  client: Anthropic,
  userMessage: string,
  retryContext: string = "",
): Promise<RawMappingPayload> {
  let prompt = userMessage;
  if (retryContext) {
    if (retryContext === "zero_non_empty_answers") {
      prompt =
        `${userMessage}\n\n` +
        "Retry context: previous output had zero non-empty proposed_answer values. " +
        "Re-evaluate the document and provide best-effort non-empty answers wherever any evidence exists. " +
        "Use empty answers only when there is truly no support in the document. " +
        "Return one valid tool payload only.";
    } else {
      prompt =
        `${userMessage}\n\n` +
        `Retry context: previous output violated structured contract (${retryContext}). ` +
        "Return one valid tool payload only.";
    }
  }

  const response = await client.messages.create({
    model: settings.model_name,
    max_tokens: 16384,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    tools: [
      {
        name: _TOOL_NAME,
        description:
          "Submit field mappings in the required structured schema.",
        input_schema: MAPPING_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: _TOOL_NAME },
  });


  for (const block of response.content) {
    if (block.type !== "tool_use") continue;
    if (block.name !== _TOOL_NAME) continue;
    const payload = block.input;
    if (typeof payload !== "object" || payload === null) {
      throw new Error("Tool payload was not a JSON object");
    }
    return payload as RawMappingPayload;
  }

  throw new Error("Claude did not return required structured tool output");
}

// ---------------------------------------------------------------------------
// Count non-empty answers in raw result
// ---------------------------------------------------------------------------

function _countNonEmptyRawAnswers(resultData: RawMappingPayload): number {
  let count = 0;
  for (const rawMapping of resultData.mappings ?? []) {
    if (
      typeof rawMapping === "object" &&
      rawMapping !== null &&
      typeof rawMapping.proposed_answer === "string" &&
      rawMapping.proposed_answer.trim()
    ) {
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Resolve a raw field_id / label back to the canonical field_id
// ---------------------------------------------------------------------------

function _resolveFieldId(
  rawFieldId: string,
  rawFieldLabel: string,
  opts: {
    aliasToFieldId: Record<string, string>;
    fieldLookup: Record<string, FormField>;
    lowerFieldIdLookup: Record<string, string>;
    normalizedLabelLookup: Record<string, string>;
  },
): string | null {
  // Exact match on field_id
  if (rawFieldId in opts.fieldLookup) return rawFieldId;

  // Match via alias (e.g. F001)
  if (rawFieldId in opts.aliasToFieldId) return opts.aliasToFieldId[rawFieldId];

  // Case-insensitive field_id match
  const lowered = rawFieldId.toLowerCase();
  if (lowered in opts.lowerFieldIdLookup) return opts.lowerFieldIdLookup[lowered];

  // Exact normalised label match
  const normalizedLabel = _normalizeLabel(rawFieldLabel);
  if (normalizedLabel && normalizedLabel in opts.normalizedLabelLookup) {
    return opts.normalizedLabelLookup[normalizedLabel];
  }

  // Fuzzy label match
  if (normalizedLabel) {
    const candidates = Object.keys(opts.normalizedLabelLookup);
    const labelMatches = getCloseMatches(normalizedLabel, candidates, 1, 0.82);
    if (labelMatches.length > 0) {
      return opts.normalizedLabelLookup[labelMatches[0]];
    }
  }

  // Fuzzy field_id match
  if (rawFieldId) {
    const idCandidates = Object.keys(opts.lowerFieldIdLookup);
    const idMatches = getCloseMatches(
      rawFieldId.toLowerCase(),
      idCandidates,
      1,
      0.85,
    );
    if (idMatches.length > 0) {
      return opts.lowerFieldIdLookup[idMatches[0]];
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Validate choice-type answers against known options (with fuzzy fallback)
// ---------------------------------------------------------------------------

function _validateSingleChoice(answer: string, options: string[]): string {
  if (options.includes(answer)) return answer;
  const matches = getCloseMatches(answer, options, 1, 0.6);
  if (matches.length > 0) return matches[0];
  return answer;
}

function _splitCheckboxAnswer(answer: string): string[] {
  return answer
    .split(/[\n,;|]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function _validateCheckboxChoices(answer: string, options: string[]): string {
  const tokens = _splitCheckboxAnswer(answer);
  const candidates = tokens.length > 0 ? tokens : [answer.trim()];
  const normalized = new Set<string>();
  const resolved: string[] = [];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const best = _validateSingleChoice(candidate, options);
    if (!options.includes(best)) continue;
    const key = best.toLowerCase();
    if (normalized.has(key)) continue;
    normalized.add(key);
    resolved.push(best);
  }

  if (resolved.length === 0) {
    return answer;
  }

  return resolved.join("; ");
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function mapFields(
  doc: ParsedDocument | null,
  form: FormSchema,
  knowledgeProfile?: KnowledgeProfile | null,
  clientKnowledge?: string | null,
): Promise<MappingResult> {
  const client = getAnthropicClient();
  const docChunks = doc?.chunks ?? [];

  const { aliasToFieldId, fieldIdToAlias } = _buildAliasMaps(form.fields);
  const userMessage = buildUserMessage(
    doc,
    form,
    fieldIdToAlias,
    knowledgeProfile,
    clientKnowledge,
  );

  const retries = Math.max(1, settings.mapping_ai_retries + 1);
  let resultData: RawMappingPayload | null = null;
  let lastError = "";

  for (let attempt = 0; attempt < retries; attempt++) {
    const retryContext = attempt > 0 ? lastError : "";
    try {
      resultData = await apiSemaphore.run(() =>
        _requestMappingPayload(client, userMessage, retryContext),
      );
      const nonEmptyRaw = _countNonEmptyRawAnswers(resultData);
      if (
        nonEmptyRaw === 0 &&
        form.fields.length > 0 &&
        docChunks.length > 0 &&
        attempt < retries - 1
      ) {
        lastError = "zero_non_empty_answers";
        console.warn(
          `Claude returned 0 non-empty answers on attempt ${attempt + 1}/${retries}; retrying mapping.`,
        );
        continue;
      }
      break;
    } catch (exc) {
      lastError = exc instanceof Error ? exc.message : String(exc);
      if (attempt === retries - 1) {
        throw new Error(
          `Could not parse Claude structured mapping output: ${lastError}`,
        );
      }
    }
  }

  if (resultData === null) {
    throw new Error(
      "Could not parse Claude structured mapping output: empty result",
    );
  }

  // ----- Build lookup tables -----
  const fieldLookup: Record<string, FormField> = {};
  for (const f of form.fields) {
    fieldLookup[f.field_id] = f;
  }

  const lowerFieldIdLookup: Record<string, string> = {};
  for (const fieldId of Object.keys(fieldLookup)) {
    lowerFieldIdLookup[fieldId.toLowerCase()] = fieldId;
  }

  const normalizedLabelLookup: Record<string, string> = {};
  for (const field of form.fields) {
    const norm = _normalizeLabel(field.label);
    if (norm) {
      normalizedLabelLookup[norm] = field.field_id;
    }
  }

  const chunkByIndex: Record<number, DocChunk> = {};
  for (const c of docChunks) {
    chunkByIndex[c.index] = c;
  }

  // ----- Process raw mappings -----
  const mappingByFieldId: Record<string, FieldMapping> = {};
  const droppedUnknown: string[] = [];

  for (const rawMapping of resultData.mappings ?? []) {
    if (typeof rawMapping !== "object" || rawMapping === null) {
      console.warn("Dropping non-object mapping payload entry:", rawMapping);
      continue;
    }

    const rawFieldId = String(rawMapping.field_id ?? "").trim();
    const rawFieldLabel = String(rawMapping.field_label ?? "").trim();

    const resolvedFieldId = _resolveFieldId(rawFieldId, rawFieldLabel, {
      aliasToFieldId,
      fieldLookup,
      lowerFieldIdLookup,
      normalizedLabelLookup,
    });

    if (!resolvedFieldId) {
      droppedUnknown.push(`id='${rawFieldId}' label='${rawFieldLabel}'`);
      continue;
    }

    // Resolve source_chunk_indices to actual DocChunk objects
    const rawIndices = rawMapping.source_chunk_indices ?? [];
    const sourceChunks: DocChunk[] = [];
    if (Array.isArray(rawIndices)) {
      for (const idx of rawIndices) {
        if (typeof idx === "number" && idx in chunkByIndex) {
          sourceChunks.push(chunkByIndex[idx]);
        }
      }
    }

    // Build normalised payload
    const fieldLabel =
      rawFieldLabel || fieldLookup[resolvedFieldId]?.label || "";
    const proposedAnswer = String(rawMapping.proposed_answer ?? "");
    const sourceCitation = String(rawMapping.source_citation ?? "");
    const confidence = String(rawMapping.confidence ?? "medium");
    const reasoning = String(rawMapping.reasoning ?? "");

    let mapping: FieldMapping;
    try {
      mapping = {
        field_id: resolvedFieldId,
        field_label: fieldLabel,
        proposed_answer: proposedAnswer,
        source_citation: sourceCitation,
        confidence,
        reasoning,
        source_chunks: sourceChunks,
      };
    } catch (exc) {
      console.warn("Dropping invalid mapping payload:", exc);
      continue;
    }

    const field = fieldLookup[mapping.field_id];
    if (!field) {
      console.warn(
        `Dropping mapping for unknown field_id: ${mapping.field_id}`,
      );
      continue;
    }

    // Validate choice-type answers against known options
    if (field.options && field.options.length > 0 && mapping.proposed_answer) {
      if (
        field.field_type === "radio" ||
        field.field_type === "dropdown" ||
        field.field_type === "linear_scale"
      ) {
        mapping.proposed_answer = _validateSingleChoice(
          mapping.proposed_answer,
          field.options,
        );
      } else if (field.field_type === "checkbox") {
        mapping.proposed_answer = _validateCheckboxChoices(
          mapping.proposed_answer,
          field.options,
        );
      }
    }

    mappingByFieldId[field.field_id] = mapping;
  }

  // ----- Process unmapped_fields from Claude's response -----
  const unmappedFields: string[] = [];
  const seenUnmapped = new Set<string>();

  for (const fieldId of resultData.unmapped_fields ?? []) {
    if (typeof fieldId !== "string") continue;
    const resolvedUnmapped = _resolveFieldId(fieldId.trim(), "", {
      aliasToFieldId,
      fieldLookup,
      lowerFieldIdLookup,
      normalizedLabelLookup,
    });
    if (!resolvedUnmapped) {
      console.warn(
        `Dropping unknown field_id in unmapped_fields: ${fieldId}`,
      );
      continue;
    }
    if (seenUnmapped.has(resolvedUnmapped)) continue;
    seenUnmapped.add(resolvedUnmapped);
    unmappedFields.push(resolvedUnmapped);
  }

  // ----- Guarantee one mapping row per scraped field -----
  const mappings: FieldMapping[] = [];
  for (const field of form.fields) {
    const existing = mappingByFieldId[field.field_id];
    if (existing) {
      mappings.push(existing);
      if (!existing.proposed_answer.trim() && !seenUnmapped.has(field.field_id)) {
        seenUnmapped.add(field.field_id);
        unmappedFields.push(field.field_id);
      }
      continue;
    }

    // No mapping returned for this field — create a placeholder
    mappings.push({
      field_id: field.field_id,
      field_label: field.label,
      proposed_answer: "",
      source_citation: "",
      confidence: "low",
      reasoning: "No supported mapping returned for this field.",
      source_chunks: [],
    });
    if (!seenUnmapped.has(field.field_id)) {
      seenUnmapped.add(field.field_id);
      unmappedFields.push(field.field_id);
    }
  }

  // ----- Logging summary -----
  const nonEmptyFinal = mappings.filter((m) =>
    m.proposed_answer.trim(),
  ).length;
  if (droppedUnknown.length > 0) {
    console.warn(
      `Dropped ${droppedUnknown.length} unresolved mapping rows (examples: ${droppedUnknown.slice(0, 5).join("; ")})`,
    );
  }
  console.info(
    `Mapping summary: fields=${form.fields.length} raw_rows=${(resultData.mappings ?? []).length} resolved_rows=${Object.keys(mappingByFieldId).length} non_empty=${nonEmptyFinal} unmapped=${unmappedFields.length}`,
  );
  if (nonEmptyFinal === 0 && form.fields.length > 0 && docChunks.length > 0) {
    console.warn(
      "Mapping produced zero non-empty answers despite non-empty document and field set.",
    );
  }

  return {
    mappings,
    unmapped_fields: unmappedFields,
    doc_chunks: [...docChunks],
  };
}
