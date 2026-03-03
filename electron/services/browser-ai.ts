// ---------------------------------------------------------------------------
// browser-ai.ts — AI-guided navigation control selection
//
// Uses the Anthropic Node SDK to ask Claude which navigation control should
// be clicked to advance to the next page of a Microsoft Form.
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";

import { settings } from "./config";
import type { NavigationElement, PageSnapshot } from "./page-model";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You pick the forward navigation control on a Microsoft Forms page.
You MUST call the provided tool exactly once.
Never pick Back, Previous, Cancel, Submit, Send, Done, or Finish as a forward action.
If there is no control that clearly advances to the next page, return action NONE.
`;

const TOOL_NAME = "choose_navigation_action";

const TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    action: { type: "string" as const, enum: ["CLICK", "NONE"] },
    index: { type: "integer" as const, minimum: 0 },
    reason: { type: "string" as const },
  },
  required: ["action"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface NavigationAIDecision {
  action: string;
  index: number | null;
  reason: string;
  error_code: string;
  error_detail: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _candidateLine(item: NavigationElement): string {
  return (
    `index=${item.index}; dom_index=${item.dom_index}; text='${item.text}'; ` +
    `aria='${item.aria_label}'; title='${item.title_attr}'; dataId='${item.data_automation_id}'; ` +
    `tag='${item.tag}'; role='${item.role}'; ` +
    `visible=${item.visible}; disabled=${item.disabled}; ` +
    `x=${Math.trunc(item.x)}; y=${Math.trunc(item.y)}; w=${Math.trunc(item.width)}; h=${Math.trunc(item.height)}`
  );
}

function _buildUserPrompt(
  snapshot: PageSnapshot,
  candidates: NavigationElement[],
  retryContext: string = "",
): string {
  const questions = snapshot.questions.slice(0, 8);
  const lines: string[] = [
    `page_indicator: ${snapshot.page_indicator || "UNKNOWN"}`,
    `questions_visible: ${snapshot.questions.length}`,
    "question_samples:",
  ];
  for (const q of questions) {
    lines.push(`- ${q}`);
  }
  lines.push(`dom_excerpt: ${snapshot.dom_excerpt.slice(0, 1500)}`);
  lines.push("navigation_candidates:");
  for (const c of candidates) {
    lines.push(`- ${_candidateLine(c)}`);
  }
  if (retryContext) {
    lines.push(`retry_context: ${retryContext}`);
    lines.push(
      "retry_requirement: respond with one tool call and ensure CLICK uses a listed index only",
    );
  }
  return lines.join("\n");
}

function _parseToolPayload(
  payload: unknown,
  validIndices: Set<number>,
): NavigationAIDecision {
  if (typeof payload !== "object" || payload === null) {
    return {
      action: "INVALID",
      index: null,
      reason: "",
      error_code: "tool_payload_not_object",
      error_detail: "Tool payload was not a JSON object.",
    };
  }

  const rec = payload as Record<string, unknown>;
  const action = String(rec.action ?? "").toUpperCase();
  const reason = String(rec.reason ?? "").trim();

  if (action === "NONE") {
    return { action: "NONE", index: null, reason, error_code: "", error_detail: "" };
  }

  if (action !== "CLICK") {
    return {
      action: "INVALID",
      index: null,
      reason,
      error_code: "unexpected_action",
      error_detail: `Unsupported action '${action}'.`,
    };
  }

  const indexValue = rec.index;
  if (typeof indexValue !== "number" || !Number.isInteger(indexValue)) {
    return {
      action: "INVALID",
      index: null,
      reason,
      error_code: "missing_or_invalid_index",
      error_detail: "CLICK action did not include a valid integer index.",
    };
  }

  if (!validIndices.has(indexValue)) {
    return {
      action: "INVALID",
      index: null,
      reason,
      error_code: "index_out_of_range",
      error_detail: `Index ${indexValue} is not in provided candidates.`,
    };
  }

  return {
    action: "CLICK",
    index: indexValue,
    reason,
    error_code: "",
    error_detail: "",
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ask Claude to choose which navigation control to click in order to advance
 * to the next page. Returns a structured decision with action, index, and
 * reasoning (or an error indication).
 */
export async function chooseNextWithAI(
  snapshot: PageSnapshot,
  candidates: NavigationElement[],
  retryContext: string = "",
): Promise<NavigationAIDecision> {
  if (!settings.anthropic_api_key) {
    return {
      action: "INVALID",
      index: null,
      reason: "",
      error_code: "missing_api_key",
      error_detail: "ANTHROPIC_API_KEY is not configured.",
    };
  }

  if (candidates.length === 0) {
    return {
      action: "NONE",
      index: null,
      reason: "No actionable navigation candidates.",
      error_code: "",
      error_detail: "",
    };
  }

  const client = new Anthropic({ apiKey: settings.anthropic_api_key });
  const prompt = _buildUserPrompt(snapshot, candidates, retryContext);

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: settings.model_name,
      max_tokens: 256,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
      tools: [
        {
          name: TOOL_NAME,
          description:
            "Choose a forward navigation action for this page.",
          input_schema: TOOL_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: TOOL_NAME },
    });
  } catch (exc) {
    return {
      action: "INVALID",
      index: null,
      reason: "",
      error_code: "anthropic_request_failed",
      error_detail: String(exc),
    };
  }


  for (const block of response.content) {
    if (block.type !== "tool_use") continue;
    if (block.name !== TOOL_NAME) continue;
    const validIndices = new Set(candidates.map((item) => item.index));
    return _parseToolPayload(block.input, validIndices);
  }

  return {
    action: "INVALID",
    index: null,
    reason: "",
    error_code: "missing_tool_use",
    error_detail: "Claude did not return the required tool output.",
  };
}
