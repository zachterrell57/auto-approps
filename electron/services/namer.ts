// ---------------------------------------------------------------------------
// namer.ts — AI-powered session naming via Haiku
//
// Calls claude-haiku-4-5-20251001 to generate a short, descriptive session
// name from the document filename, form title, and field labels.
// ---------------------------------------------------------------------------

import { getAnthropicClient } from "./anthropic-client.js";
import { apiSemaphore } from "./concurrency.js";
import { settings } from "./config.js";

const NAMING_MODEL = "claude-haiku-4-5-20251001";

/**
 * Call Haiku to produce a short, descriptive session name.
 *
 * Falls back to `formTitle` or `documentFilename` when the API key is missing
 * or the request fails.
 */
export async function generateSessionName(opts: {
  documentFilename?: string | null;
  formTitle?: string | null;
  formFieldLabels?: string[];
}): Promise<string> {
  const { documentFilename, formTitle, formFieldLabels } = opts;
  const fallback = formTitle || documentFilename || "Untitled Session";

  if (!settings.anthropic_api_key) {
    return fallback;
  }

  const contextParts: string[] = [];
  if (documentFilename) {
    contextParts.push(`Document: ${documentFilename}`);
  }
  if (formTitle) {
    contextParts.push(`Form: ${formTitle}`);
  }
  if (formFieldLabels && formFieldLabels.length > 0) {
    const preview = formFieldLabels.slice(0, 8).join(", ");
    contextParts.push(`Fields: ${preview}`);
  }

  if (contextParts.length === 0) {
    return "Untitled Session";
  }

  const prompt =
    "Generate a short, descriptive name (max 6 words) for a form-filling session " +
    "based on the following context. Return ONLY the name, nothing else.\n\n" +
    contextParts.join("\n");

  try {
    const client = getAnthropicClient();
    const response = await apiSemaphore.run(() =>
      client.messages.create({
        model: NAMING_MODEL,
        max_tokens: 30,
        temperature: 0.7,
        messages: [{ role: "user", content: prompt }],
      }),
    );

    const block = response.content[0];
    if (block.type !== "text") return fallback;

    let name = block.text.trim().replace(/^["']|["']$/g, "");
    if (name.length > 80) {
      name = name.slice(0, 77) + "...";
    }
    return name || fallback;
  } catch (err) {
    console.warn("Failed to generate session name via Haiku:", err);
    return fallback;
  }
}
