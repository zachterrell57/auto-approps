import Anthropic from "@anthropic-ai/sdk";

import { settings } from "./config";
import {
  hearingAiModelMetadata,
  summarizeCongressionalContext,
  type CongressionalContext,
} from "./congressional-context";
import {
  buildProviderCostSummary,
  providerUsageAndCostFields,
  transcriptionComponentFromMetadata,
  type ProviderCostComponent,
} from "./hearing-cost";
import {
  type HearingClaim,
  type HearingJob,
  type HearingOutputType,
  type HearingTranscriptSegment,
  type HearingWatchHit,
  type HearingWatchItem,
} from "./hearing-models";
import { createHearingOutput } from "./hearing-store";
import { formatMs, transcriptText } from "./hearing-transcript";

const TOOL_NAME = "submit_hearing_output";

const SYSTEM_PROMPT = `You produce source-grounded congressional hearing intelligence for lobbying teams.

Rules:
1. Every material claim must cite transcript segment IDs or official congressional source labels.
2. Separate what was said from why it matters to the selected client.
3. Do not invent bill status, member position, witness statement, vote outcome, or agency action.
4. If support is thin, mark needsReview true and explain the uncertainty.
5. Watchlist non-hits mean "not detected" unless the transcript covers the full hearing.
6. Write in a formal lobbying memo style, not a generic transcript summary.
7. Return exactly one tool call.`;

const OUTPUT_SCHEMA: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    markdown: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          supportingSegmentIds: {
            type: "array",
            items: { type: "string" },
          },
          confidence: { type: "number" },
          needsReview: { type: "boolean" },
        },
        required: [
          "title",
          "summary",
          "supportingSegmentIds",
          "confidence",
          "needsReview",
        ],
        additionalProperties: false,
      },
    },
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claimText: { type: "string" },
          supportingSegmentIds: {
            type: "array",
            items: { type: "string" },
          },
          supportingExternalSources: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                url: { type: "string" },
                source_type: { type: "string" },
                reliability_tier: { type: "number" },
              },
              required: ["title", "url", "source_type", "reliability_tier"],
              additionalProperties: false,
            },
          },
          confidence: { type: "number" },
          verificationStatus: {
            type: "string",
            enum: ["supported", "weak_support", "unsupported", "needs_review"],
          },
        },
        required: [
          "claimText",
          "supportingSegmentIds",
          "supportingExternalSources",
          "confidence",
          "verificationStatus",
        ],
        additionalProperties: false,
      },
    },
    reviewFlags: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["markdown", "sections", "claims", "reviewFlags"],
  additionalProperties: false,
};

interface RawHearingOutput {
  markdown?: string;
  sections?: Array<{
    title?: string;
    summary?: string;
    supportingSegmentIds?: string[];
    confidence?: number;
    needsReview?: boolean;
  }>;
  claims?: Array<{
    claimText?: string;
    supportingSegmentIds?: string[];
    supportingExternalSources?: Array<{
      title?: string;
      url?: string;
      source_type?: string;
      reliability_tier?: number;
    }>;
    confidence?: number;
    verificationStatus?: HearingClaim["verification_status"];
  }>;
  reviewFlags?: string[];
}

interface AiOutputResult {
  output: RawHearingOutput;
  providerUsage: ProviderCostComponent;
}

function titleForType(type: HearingOutputType): string {
  if (type === "targeted_recap") return "Targeted Watchlist Recap";
  if (type === "pre_hearing_brief") return "Pre-Hearing Brief";
  if (type === "transcript") return "Transcript Package";
  if (type === "mention_log") return "Mention Log";
  return "Committee Hearing Memorandum";
}

function citation(segment: HearingTranscriptSegment): string {
  return `${segment.segmentId} (${formatMs(segment.startMs)}-${formatMs(segment.endMs)})`;
}

function segmentsById(
  segments: HearingTranscriptSegment[],
): Record<string, HearingTranscriptSegment> {
  return Object.fromEntries(segments.map((segment) => [segment.segmentId, segment]));
}

function relevantSegments(
  segments: HearingTranscriptSegment[],
  hits: HearingWatchHit[],
  type: HearingOutputType,
): HearingTranscriptSegment[] {
  if (type !== "targeted_recap" || hits.length === 0) {
    return segments;
  }
  const ids = new Set(hits.flatMap((hit) => hit.transcriptSegmentIds));
  return segments.filter((segment) => ids.has(segment.segmentId));
}

function buildPrompt(args: {
  job: HearingJob;
  outputType: HearingOutputType;
  segments: HearingTranscriptSegment[];
  watchItems: HearingWatchItem[];
  watchHits: HearingWatchHit[];
  congressionalContext: CongressionalContext;
  reviewerInstructions?: string;
}): string {
  const transcript = transcriptText(args.segments).slice(0, 120_000);
  const contextSummary = summarizeCongressionalContext(args.congressionalContext);
  return `## Output Type
${titleForType(args.outputType)}

## Hearing Metadata
Title: ${args.job.hearing_title || "Untitled hearing"}
Committee: ${args.job.committee || "Unknown committee"}
Subcommittee: ${args.job.subcommittee || "None detected"}
Chamber: ${args.job.chamber || "Unknown chamber"}
Date/time: ${args.job.hearing_datetime || "Unknown"}
Source URL: ${args.job.source_url}
Source reliability tier: ${args.job.source_reliability_tier}
Witnesses: ${args.job.witnesses.map((w) => [w.name, w.title, w.organization].filter(Boolean).join(", ")).join("; ") || "Not detected"}

## Client Context
Client: ${args.job.client_name || "None configured"}
Aliases/products/subsidiaries: ${[
    ...args.job.client_context.aliases,
    ...args.job.client_context.products,
    ...args.job.client_context.subsidiaries,
  ].join(", ") || "None configured"}
Competitors/trade associations: ${[
    ...args.job.client_context.competitors,
    ...args.job.client_context.trade_associations,
  ].join(", ") || "None configured"}
Priority bills/programs: ${[
    ...args.job.client_context.priority_bills,
    ...args.job.client_context.programs,
    ...args.job.client_context.amendments,
  ].join(", ") || "None configured"}
Care about: ${args.job.client_context.care_about || "None configured"}
Ignore unless directly mentioned: ${args.job.client_context.ignore_unless_directly_mentioned || "None configured"}
Preferred style: ${args.job.client_context.preferred_output_style}
Confidential notes: ${args.job.client_context.confidential_internal_notes || "None"}

## Watchlist
Configured items:
${args.watchItems.map((item) => `- ${item.label} (${item.type}, ${item.importance}); aliases: ${item.aliases.join(", ") || "none"}`).join("\n") || "None"}

Detected hits:
${args.watchHits.map((hit) => `- ${hit.triggerText} at ${formatMs(hit.startMs)}-${formatMs(hit.endMs)}; speakers: ${hit.speakerLabels.join(", ")}; segment IDs: ${hit.transcriptSegmentIds.join(", ")}`).join("\n") || "No hits detected"}

## Official Congressional Context
${contextSummary || "No official context was retrieved."}

## Reviewer Instructions
${args.reviewerInstructions?.trim() || "None"}

## Transcript Segments
${transcript}

## Required Sections
For full memo: title block, client relevance summary, executive summary, what changed/why it matters, key issues, client/bill/topic mentions, member statements, witness statements, key exchanges, partisan dynamics/committee posture, related bills/status, attendees, source notes/citations, review flags.
For targeted recap: bottom line, hit summary table, detailed exchanges, bills/actions mentioned, posture, non-hits, recommended analyst follow-up, transcript excerpts with timecodes.
For pre-hearing brief: hearing background, committee jurisdiction, witness bios, relevant pending bills, members likely to care, suggested watchlist terms, known client risks/opportunities.`;
}

async function requestAiOutput(prompt: string): Promise<AiOutputResult> {
  if (!settings.anthropic_api_key) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  const client = new Anthropic({ apiKey: settings.anthropic_api_key });
  const response = await client.messages.create({
    model: settings.model_name,
    max_tokens: 16384,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    tools: [
      {
        name: TOOL_NAME,
        description: "Submit the hearing memo or recap with claims and citations.",
        input_schema: OUTPUT_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
  });
  const responseRecord = response as unknown as Record<string, unknown>;
  const { usage, costUsd } = providerUsageAndCostFields(responseRecord);
  const providerUsage: ProviderCostComponent = {
    provider: "anthropic",
    service: "ai_generation",
    model: typeof response.model === "string" ? response.model : settings.model_name,
    cost_usd: costUsd,
    usage,
    ...(costUsd === null ? { unavailable_reason: "AI generation unavailable" } : {}),
  };

  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === TOOL_NAME) {
      return {
        output: block.input as RawHearingOutput,
        providerUsage,
      };
    }
  }
  throw new Error("Claude did not return required hearing output.");
}

function fallbackMarkdown(args: {
  job: HearingJob;
  outputType: HearingOutputType;
  segments: HearingTranscriptSegment[];
  watchItems: HearingWatchItem[];
  watchHits: HearingWatchHit[];
  congressionalContext: CongressionalContext;
}): string {
  const lines: string[] = [];
  lines.push(`# ${titleForType(args.outputType)}`);
  lines.push("");
  lines.push(`**Client:** ${args.job.client_name || "None configured"}`);
  lines.push(`**Hearing:** ${args.job.hearing_title || "Untitled hearing"}`);
  lines.push(`**Committee:** ${args.job.committee || "Unknown committee"}`);
  lines.push(`**Date:** ${args.job.hearing_datetime || "Unknown"}`);
  lines.push(`**Source:** ${args.job.source_url}`);
  lines.push("");
  lines.push("## Client Relevance Summary");
  if (args.watchHits.length > 0) {
    lines.push(
      `${args.watchHits.length} watchlist hit(s) were detected for configured client terms.`,
    );
  } else {
    lines.push("No configured watchlist hits were detected in the available transcript.");
  }
  if (args.job.client_context.care_about.trim()) {
    lines.push(`Client care-about instructions: ${args.job.client_context.care_about.trim()}`);
  }
  lines.push("");
  lines.push("## Executive Summary");
  const firstSegments = args.segments.slice(0, 6);
  for (const segment of firstSegments) {
    lines.push(`- ${segment.speakerLabel} (${citation(segment)}): ${segment.text.slice(0, 260)}`);
  }
  lines.push("");
  lines.push("## Key Exchanges");
  for (const hit of args.watchHits.slice(0, 10)) {
    lines.push(
      `- ${hit.triggerText} at ${formatMs(hit.startMs)}-${formatMs(hit.endMs)}. ${hit.clientRelevance} Supporting segments: ${hit.transcriptSegmentIds.join(", ")}.`,
    );
  }
  if (args.watchHits.length === 0) lines.push("- No watchlist exchanges detected.");
  lines.push("");
  lines.push("## Related Bills and Status");
  const contextSummary = summarizeCongressionalContext(args.congressionalContext);
  lines.push(contextSummary || "No bill references were detected in the available transcript/context.");
  lines.push("");
  lines.push("## Source Notes and Citations");
  lines.push(
    "This draft is generated from the available transcript segments and official context records. Analyst review is required before client delivery.",
  );
  lines.push("");
  lines.push("## Review Flags / Unresolved Questions");
  const lowConfidence = args.segments.filter(
    (segment) => segment.asrConfidence < 0.8 || segment.speakerConfidence < 0.6,
  );
  if (lowConfidence.length > 0) {
    lines.push(`- ${lowConfidence.length} segment(s) have low ASR or speaker confidence.`);
  } else {
    lines.push("- No low-confidence transcript flags detected.");
  }
  return lines.join("\n");
}

function claimsFromFallback(
  outputId: string,
  args: {
    segments: HearingTranscriptSegment[];
    watchHits: HearingWatchHit[];
    congressionalContext: CongressionalContext;
  },
): Array<Omit<HearingClaim, "id" | "hearing_output_id">> {
  const byId = segmentsById(args.segments);
  const claims: Array<Omit<HearingClaim, "id" | "hearing_output_id">> = [];
  for (const hit of args.watchHits.slice(0, 20)) {
    claims.push({
      claim_text: `Watchlist hit "${hit.triggerText}" was detected at ${formatMs(hit.startMs)}.`,
      supporting_segment_ids: hit.transcriptSegmentIds.filter((id) => byId[id]),
      supporting_external_sources: [],
      confidence: hit.confidence,
      verification_status: "supported",
    });
  }
  if (args.congressionalContext.bill_references.length > 0) {
    claims.push({
      claim_text: `Bill references detected: ${args.congressionalContext.bill_references.map((ref) => ref.raw).join(", ")}.`,
      supporting_segment_ids: [],
      supporting_external_sources: args.congressionalContext.official_sources,
      confidence: 0.82,
      verification_status: "weak_support",
    });
  }
  if (claims.length === 0 && args.segments[0]) {
    claims.push({
      claim_text: "The draft is based on the available transcript package.",
      supporting_segment_ids: [args.segments[0].segmentId],
      supporting_external_sources: [],
      confidence: 0.75,
      verification_status: "needs_review",
    });
  }
  return claims;
}

function normalizeAiClaims(raw: RawHearingOutput): Array<Omit<HearingClaim, "id" | "hearing_output_id">> {
  return (raw.claims ?? [])
    .filter((claim) => claim.claimText?.trim())
    .map((claim) => ({
      claim_text: claim.claimText?.trim() ?? "",
      supporting_segment_ids: claim.supportingSegmentIds ?? [],
      supporting_external_sources: (claim.supportingExternalSources ?? []).map((source) => ({
        title: source.title ?? "Official source",
        url: source.url ?? "",
        source_type: source.source_type ?? "official_context",
        reliability_tier: source.reliability_tier ?? 3,
      })),
      confidence: Math.max(0, Math.min(1, claim.confidence ?? 0.6)),
      verification_status: claim.verificationStatus ?? "needs_review",
    }));
}

function verifyClaims(
  claims: Array<Omit<HearingClaim, "id" | "hearing_output_id">>,
  segments: HearingTranscriptSegment[],
): Array<Omit<HearingClaim, "id" | "hearing_output_id">> {
  const segmentIds = new Set(segments.map((segment) => segment.segmentId));
  return claims.map((claim) => {
    const supportedIds = claim.supporting_segment_ids.filter((id) => segmentIds.has(id));
    const hasExternal = claim.supporting_external_sources.some((source) => source.url);
    const verificationStatus =
      supportedIds.length > 0 || hasExternal
        ? claim.verification_status === "unsupported"
          ? "weak_support"
          : claim.verification_status
        : "needs_review";
    return {
      ...claim,
      supporting_segment_ids: supportedIds,
      verification_status: verificationStatus,
      confidence:
        verificationStatus === "needs_review"
          ? Math.min(claim.confidence, 0.55)
          : claim.confidence,
    };
  });
}

export async function generateHearingOutput(args: {
  job: HearingJob;
  outputType: HearingOutputType;
  segments: HearingTranscriptSegment[];
  watchItems: HearingWatchItem[];
  watchHits: HearingWatchHit[];
  congressionalContext: CongressionalContext;
  reviewerInstructions?: string;
  useAi?: boolean;
}) {
  const startedAt = Date.now();
  const scopedSegments = relevantSegments(
    args.segments,
    args.watchHits,
    args.outputType,
  );
  let markdown = "";
  let contentJson: Record<string, unknown> = {};
  let claims: Array<Omit<HearingClaim, "id" | "hearing_output_id">> = [];
  let aiProviderUsage: ProviderCostComponent | null = null;
  const shouldUseAi = args.useAi ?? Boolean(settings.anthropic_api_key);

  if (shouldUseAi && settings.anthropic_api_key) {
    const aiResult = await requestAiOutput(
      buildPrompt({
        ...args,
        segments: scopedSegments,
      }),
    );
    const raw = aiResult.output;
    aiProviderUsage = aiResult.providerUsage;
    markdown =
      raw.markdown?.trim() ||
      fallbackMarkdown({
        ...args,
        segments: scopedSegments,
      });
    contentJson = {
      sections: raw.sections ?? [],
      reviewFlags: raw.reviewFlags ?? [],
    };
    claims = normalizeAiClaims(raw);
  } else {
    markdown = fallbackMarkdown({
      ...args,
      segments: scopedSegments,
    });
    contentJson = {
      sections: [],
      reviewFlags: ["Generated without AI because no Anthropic API key is configured."],
    };
    claims = claimsFromFallback("", {
      segments: scopedSegments,
      watchHits: args.watchHits,
      congressionalContext: args.congressionalContext,
    });
  }

  claims = verifyClaims(claims, scopedSegments);
  if (claims.length === 0) {
    claims = claimsFromFallback("", {
      segments: scopedSegments,
      watchHits: args.watchHits,
      congressionalContext: args.congressionalContext,
    });
  }

  const transcriptionProviderUsage = transcriptionComponentFromMetadata(args.job.metadata);
  const costSummary = buildProviderCostSummary([
    aiProviderUsage,
    transcriptionProviderUsage,
  ]);

  return createHearingOutput(
    args.job.id,
    args.outputType,
    markdown,
    {
      ...contentJson,
      outputType: args.outputType,
      generatedAt: new Date().toISOString(),
      transcriptSegmentCount: scopedSegments.length,
      watchHitCount: args.watchHits.length,
    },
    claims,
    hearingAiModelMetadata({
      generated_with_ai: shouldUseAi && Boolean(settings.anthropic_api_key),
      latency_ms: Date.now() - startedAt,
      estimated_cost_usd: null,
      provider_usage: {
        ...(aiProviderUsage ? { ai_generation: aiProviderUsage } : {}),
        ...(transcriptionProviderUsage
          ? { transcription: transcriptionProviderUsage }
          : {}),
      },
      cost_summary: costSummary,
    }),
  );
}
