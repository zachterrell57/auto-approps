import type { FieldType, FormField, FormSchema } from "./models";

export class GoogleFormsApiError extends Error {
  status: number;
  code:
    | "unauthorized"
    | "forbidden"
    | "not_found"
    | "insufficient_scope"
    | "api_error";

  constructor(
    status: number,
    code:
      | "unauthorized"
      | "forbidden"
      | "not_found"
      | "insufficient_scope"
      | "api_error",
    message: string,
  ) {
    super(message);
    this.name = "GoogleFormsApiError";
    this.status = status;
    this.code = code;
  }
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapChoiceType(choiceType: string): FieldType {
  const normalized = choiceType.toUpperCase();
  if (normalized === "RADIO") return "radio";
  if (normalized === "CHECKBOX") return "checkbox";
  if (normalized === "DROP_DOWN") return "dropdown";
  return "short_text";
}

function formApiErrorCode(status: number): "unauthorized" | "forbidden" | "not_found" | "api_error" {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  return "api_error";
}

function parseGoogleApiError(raw: string): {
  message: string;
  insufficientScope: boolean;
} {
  try {
    const parsed = JSON.parse(raw) as {
      error?: {
        message?: string;
        details?: Array<Record<string, unknown>>;
      };
    };
    const message = parsed?.error?.message;
    const details = Array.isArray(parsed?.error?.details) ? parsed.error.details : [];
    const hasScopeDetail = details.some((detail) => {
      if (!detail || typeof detail !== "object" || Array.isArray(detail)) return false;
      const reason = detail.reason;
      return typeof reason === "string" && reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT";
    });
    const hasScopeMessage =
      typeof message === "string" &&
      message.toLowerCase().includes("insufficient authentication scopes");
    if (typeof message === "string" && message.trim()) {
      return {
        message,
        insufficientScope: hasScopeDetail || hasScopeMessage,
      };
    }
  } catch {
    // Use fallback.
  }
  const fallback = raw.slice(0, 300) || "Google Forms API request failed.";
  return {
    message: fallback,
    insufficientScope: fallback.toLowerCase().includes("insufficient authentication scopes"),
  };
}

function extractChoiceOptions(choiceQuestion: Record<string, unknown>): string[] {
  const optionsRaw = Array.isArray(choiceQuestion.options) ? choiceQuestion.options : [];
  const options: string[] = [];
  for (const option of optionsRaw) {
    if (!option || typeof option !== "object" || Array.isArray(option)) continue;
    const value = readString((option as Record<string, unknown>).value).trim();
    if (value) options.push(value);
  }
  return options;
}

function extractLinearScaleOptions(scaleQuestion: Record<string, unknown>): string[] {
  const low = readNumber(scaleQuestion.low);
  const high = readNumber(scaleQuestion.high);
  if (low === null || high === null || high < low) return [];
  const range = high - low;
  if (range > 30) return [];
  const values: string[] = [];
  for (let value = low; value <= high; value += 1) {
    values.push(String(value));
  }
  return values;
}

function chooseFieldTypeAndOptions(
  question: Record<string, unknown>,
  warnings: string[],
  contextLabel: string,
): { fieldType: FieldType; options: string[] } {
  const textQuestion =
    question.textQuestion && typeof question.textQuestion === "object"
      ? (question.textQuestion as Record<string, unknown>)
      : null;
  if (textQuestion) {
    return {
      fieldType: readBoolean(textQuestion.paragraph) ? "long_text" : "short_text",
      options: [],
    };
  }

  const choiceQuestion =
    question.choiceQuestion && typeof question.choiceQuestion === "object"
      ? (question.choiceQuestion as Record<string, unknown>)
      : null;
  if (choiceQuestion) {
    const fieldType = mapChoiceType(readString(choiceQuestion.type));
    const options = extractChoiceOptions(choiceQuestion);
    if (fieldType === "short_text") {
      warnings.push(
        `Question "${contextLabel}" has unsupported choice type "${readString(
          choiceQuestion.type,
        )}". Defaulted to short_text.`,
      );
    }
    return { fieldType, options };
  }

  const scaleQuestion =
    question.scaleQuestion && typeof question.scaleQuestion === "object"
      ? (question.scaleQuestion as Record<string, unknown>)
      : null;
  if (scaleQuestion) {
    return {
      fieldType: "linear_scale",
      options: extractLinearScaleOptions(scaleQuestion),
    };
  }

  if (question.dateQuestion && typeof question.dateQuestion === "object") {
    return { fieldType: "date", options: [] };
  }

  if (question.timeQuestion && typeof question.timeQuestion === "object") {
    return { fieldType: "time", options: [] };
  }

  warnings.push(`Question "${contextLabel}" uses an unsupported Google Forms question type.`);
  return { fieldType: "short_text", options: [] };
}

function parseQuestionField(args: {
  question: unknown;
  label: string;
  pageIndex: number;
  warnings: string[];
}): FormField | null {
  if (!args.question || typeof args.question !== "object" || Array.isArray(args.question)) {
    return null;
  }
  const question = args.question as Record<string, unknown>;
  const questionId = readString(question.questionId).trim();
  if (!questionId) {
    args.warnings.push(`Skipped a question without questionId on page ${args.pageIndex + 1}.`);
    return null;
  }

  const required = readBoolean(question.required);
  const fieldId = `google.${questionId}`;
  const label = args.label.trim() || fieldId;
  const { fieldType, options } = chooseFieldTypeAndOptions(
    question,
    args.warnings,
    label,
  );

  return {
    field_id: fieldId,
    label,
    field_type: fieldType,
    required,
    options,
    page_index: args.pageIndex,
    target_locator: null,
    exportable: false,
    export_issue: "",
  };
}

export function extractGoogleFormId(url: string): string | null {
  let path = "";
  try {
    const parsed = new URL(url);
    path = parsed.pathname;
  } catch {
    return null;
  }

  const embedMatch = path.match(/\/forms\/d\/e\/([A-Za-z0-9_-]+)/);
  if (embedMatch?.[1]) return embedMatch[1];

  const directMatch = path.match(/\/forms\/d\/([A-Za-z0-9_-]+)/);
  if (directMatch?.[1]) return directMatch[1];

  return null;
}

export async function scrapeGoogleFormViaApi(
  url: string,
  accessToken: string,
): Promise<FormSchema> {
  const formId = extractGoogleFormId(url);
  if (!formId) {
    throw new Error("Could not parse Google Form ID from URL.");
  }

  const endpoint = `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}`;
  const resp = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  const raw = await resp.text();
  if (!resp.ok) {
    const { message, insufficientScope } = parseGoogleApiError(raw);
    const code =
      resp.status === 403 && insufficientScope
        ? "insufficient_scope"
        : formApiErrorCode(resp.status);
    throw new GoogleFormsApiError(
      resp.status,
      code,
      `Google Forms API request failed (HTTP ${resp.status}): ${message}`,
    );
  }

  let parsed: Record<string, unknown> = {};
  try {
    const json = JSON.parse(raw) as Record<string, unknown>;
    if (json && typeof json === "object" && !Array.isArray(json)) {
      parsed = json;
    }
  } catch {
    throw new GoogleFormsApiError(
      200,
      "api_error",
      "Google Forms API returned non-JSON data.",
    );
  }

  const info =
    parsed.info && typeof parsed.info === "object" && !Array.isArray(parsed.info)
      ? (parsed.info as Record<string, unknown>)
      : {};
  const items = Array.isArray(parsed.items) ? parsed.items : [];

  const title = readString(info.title).trim() || "Untitled Form";
  const description = readString(info.description).trim();

  const warnings: string[] = [];
  const fields: FormField[] = [];
  let pageIndex = 0;

  for (const itemUnknown of items) {
    if (!itemUnknown || typeof itemUnknown !== "object" || Array.isArray(itemUnknown)) {
      continue;
    }
    const item = itemUnknown as Record<string, unknown>;
    const itemTitle = readString(item.title).trim();

    if (item.pageBreakItem && typeof item.pageBreakItem === "object") {
      pageIndex += 1;
      continue;
    }

    const questionItem =
      item.questionItem && typeof item.questionItem === "object"
        ? (item.questionItem as Record<string, unknown>)
        : null;
    if (questionItem) {
      const field = parseQuestionField({
        question: questionItem.question,
        label: itemTitle,
        pageIndex,
        warnings,
      });
      if (field) fields.push(field);
      continue;
    }

    const questionGroupItem =
      item.questionGroupItem && typeof item.questionGroupItem === "object"
        ? (item.questionGroupItem as Record<string, unknown>)
        : null;
    if (questionGroupItem) {
      const questions = Array.isArray(questionGroupItem.questions)
        ? questionGroupItem.questions
        : [];
      if (questions.length === 0) {
        warnings.push(
          `Question group "${itemTitle || "Untitled group"}" had no parseable questions.`,
        );
      }

      for (const groupedQuestion of questions) {
        let label = itemTitle || "Untitled grouped question";
        if (
          groupedQuestion &&
          typeof groupedQuestion === "object" &&
          !Array.isArray(groupedQuestion)
        ) {
          const q = groupedQuestion as Record<string, unknown>;
          if (q.rowQuestion && typeof q.rowQuestion === "object") {
            const row = q.rowQuestion as Record<string, unknown>;
            const rowTitle = readString(row.title).trim();
            if (rowTitle && itemTitle && rowTitle !== itemTitle) {
              label = `${itemTitle} - ${rowTitle}`;
            } else if (rowTitle) {
              label = rowTitle;
            }
          }
        }

        const field = parseQuestionField({
          question: groupedQuestion,
          label,
          pageIndex,
          warnings,
        });
        if (field) fields.push(field);
      }
      continue;
    }
  }

  return {
    title,
    description,
    fields,
    page_count: Math.max(1, pageIndex + 1),
    target_kind: "web_form",
    target_url: url,
    target_filename: null,
    target_title: title,
    target_provider: "google",
    parse_warnings: warnings,
    url,
    provider: "google",
    scrape_warnings: warnings,
    form_state: "open",
    form_state_message: "",
  };
}
