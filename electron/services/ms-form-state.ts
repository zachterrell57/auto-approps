import Anthropic from "@anthropic-ai/sdk";
import { type Page } from "playwright";

import { settings } from "./config";
import { getPageSnapshot, type PageSnapshot } from "./page-model";

export type MsFormState =
  | "open"
  | "needs_interaction"
  | "closed"
  | "login_required"
  | "permission_required"
  | "unavailable"
  | "unsupported"
  | "unknown";

export interface MsFormStateDiagnosis {
  state: MsFormState;
  message: string;
  source: "heuristic" | "ai" | "fallback";
  snapshot: PageSnapshot;
}

const TOOL_NAME = "classify_ms_form_state";

const SYSTEM_PROMPT = `Classify the current Microsoft Forms page state.
You MUST call the provided tool exactly once.

Choose:
- open: visible form questions are available to scrape now
- needs_interaction: the form looks available, but a Start/Begin/Continue action is needed before questions appear
- closed: the form is not accepting responses
- login_required: the page is blocked behind sign-in/authentication
- permission_required: the viewer lacks permission to access the form
- unavailable: the form is deleted, expired, missing, or otherwise unavailable
- unsupported: the form looks real and possibly open, but the current page layout is not scrapeable from the provided evidence
- unknown: not enough evidence to classify safely

If the page clearly says responses are not being accepted, choose closed.
If it clearly asks the user to sign in, choose login_required.
If there are visible questions, choose open.
`;

const TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    state: {
      type: "string" as const,
      enum: [
        "open",
        "needs_interaction",
        "closed",
        "login_required",
        "permission_required",
        "unavailable",
        "unsupported",
        "unknown",
      ],
    },
    message: { type: "string" as const },
  },
  required: ["state", "message"],
  additionalProperties: false,
};

function _normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

function _candidateBlob(snapshot: PageSnapshot): string {
  return snapshot.navigation
    .filter((item) => item.visible && !item.disabled)
    .map((item) =>
      _normalizeText(
        [
          item.text,
          item.aria_label,
          item.title_attr,
          item.data_automation_id,
        ].join(" "),
      ).toLowerCase(),
    )
    .join(" || ");
}

function _includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function _defaultMessage(state: MsFormState): string {
  switch (state) {
    case "closed":
      return "This Microsoft Form is currently not accepting responses.";
    case "login_required":
      return "This Microsoft Form requires login before its questions can be viewed.";
    case "permission_required":
      return "You do not have permission to access this Microsoft Form.";
    case "unavailable":
      return "This Microsoft Form is no longer available.";
    case "needs_interaction":
      return "This Microsoft Form needs an initial Start or Continue action before questions appear.";
    case "unsupported":
      return "This Microsoft Form appears to be available, but its current layout could not be scraped automatically.";
    default:
      return "";
  }
}

function _heuristicDiagnosis(
  page: Page,
  snapshot: PageSnapshot,
): MsFormStateDiagnosis | null {
  const url = page.url().toLowerCase();
  const domExcerpt = snapshot.dom_excerpt.toLowerCase();
  const navBlob = _candidateBlob(snapshot);

  if (url.includes("login.microsoftonline.com")) {
    return {
      state: "login_required",
      message:
        "This Microsoft Form requires login before its questions can be viewed.",
      source: "heuristic",
      snapshot,
    };
  }

  if (snapshot.questions.length > 0) {
    return {
      state: "open",
      message: "",
      source: "heuristic",
      snapshot,
    };
  }

  if (
    _includesAny(domExcerpt, [
      "this form is currently not accepting responses",
      "this form is no longer accepting responses",
      "this form is not accepting responses",
    ])
  ) {
    return {
      state: "closed",
      message: "This Microsoft Form is currently not accepting responses.",
      source: "heuristic",
      snapshot,
    };
  }

  if (
    _includesAny(domExcerpt, [
      "this form is no longer available",
      "sorry, this form is no longer available",
      "this form has been deleted",
      "we couldn't find a form with that link",
      "we could not find a form with that link",
    ])
  ) {
    return {
      state: "unavailable",
      message: "This Microsoft Form is no longer available.",
      source: "heuristic",
      snapshot,
    };
  }

  if (
    _includesAny(domExcerpt, [
      "you don't have permission",
      "you do not have permission",
      "you need permission",
      "request access",
      "access denied",
    ])
  ) {
    return {
      state: "permission_required",
      message: "You do not have permission to access this Microsoft Form.",
      source: "heuristic",
      snapshot,
    };
  }

  if (
    _includesAny(domExcerpt, [
      "sign in",
      "sign into your account",
      "enter password",
      "use your microsoft account",
    ])
  ) {
    return {
      state: "login_required",
      message:
        "This Microsoft Form requires login before its questions can be viewed.",
      source: "heuristic",
      snapshot,
    };
  }

  if (_includesAny(navBlob, ["start", "begin", "continue", "next"])) {
    return {
      state: "needs_interaction",
      message:
        "This Microsoft Form needs an initial Start or Continue action before questions appear.",
      source: "heuristic",
      snapshot,
    };
  }

  return null;
}

async function _buildPrompt(
  page: Page,
  snapshot: PageSnapshot,
): Promise<string> {
  const navLines = snapshot.navigation
    .filter((item) => item.visible)
    .slice(0, 8)
    .map(
      (item) =>
        `- text='${item.text}' aria='${item.aria_label}' title='${item.title_attr}' dataId='${item.data_automation_id}' disabled=${item.disabled}`,
    );
  let pageTitle = "";
  try {
    pageTitle = _normalizeText(await page.title());
  } catch {
    pageTitle = "";
  }

  return [
    `page_url: ${page.url()}`,
    `page_title: ${pageTitle || "UNKNOWN"}`,
    `page_indicator: ${snapshot.page_indicator || "UNKNOWN"}`,
    `questions_visible: ${snapshot.questions.length}`,
    "visible_navigation:",
    ...(navLines.length > 0 ? navLines : ["- NONE"]),
    `dom_excerpt: ${snapshot.dom_excerpt.slice(0, 2500)}`,
  ].join("\n");
}

async function _diagnoseWithAI(
  page: Page,
  snapshot: PageSnapshot,
): Promise<MsFormStateDiagnosis | null> {
  if (!settings.anthropic_api_key) {
    return null;
  }

  const client = new Anthropic({ apiKey: settings.anthropic_api_key });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: settings.model_name,
      max_tokens: 192,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: await _buildPrompt(page, snapshot),
        },
      ],
      tools: [
        {
          name: TOOL_NAME,
          description: "Classify the current Microsoft Forms page state.",
          input_schema: TOOL_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: TOOL_NAME },
    });
  } catch {
    return null;
  }

  for (const block of response.content) {
    if (block.type !== "tool_use" || block.name !== TOOL_NAME) continue;
    const payload = block.input;
    if (typeof payload !== "object" || payload === null) return null;
    const state = _normalizeText(
      String((payload as Record<string, unknown>).state ?? ""),
    ) as MsFormState;
    let message = _normalizeText(
      String((payload as Record<string, unknown>).message ?? ""),
    );
    const normalizedState =
      state === "open" && snapshot.questions.length === 0
        ? "unsupported"
        : state;
    if (
      ![
        "open",
        "needs_interaction",
        "closed",
        "login_required",
        "permission_required",
        "unavailable",
        "unsupported",
        "unknown",
      ].includes(normalizedState)
    ) {
      return null;
    }
    if (!message) {
      message = _defaultMessage(normalizedState);
    }
    return {
      state: normalizedState,
      message,
      source: "ai",
      snapshot,
    };
  }

  return null;
}

export async function diagnoseMsFormState(
  page: Page,
): Promise<MsFormStateDiagnosis> {
  const snapshot = await getPageSnapshot(page);

  const heuristic = _heuristicDiagnosis(page, snapshot);
  if (heuristic) return heuristic;

  const aiDiagnosis = await _diagnoseWithAI(page, snapshot);
  if (aiDiagnosis) return aiDiagnosis;

  return {
    state: "unknown",
    message: "",
    source: "fallback",
    snapshot,
  };
}
