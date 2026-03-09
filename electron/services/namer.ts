// ---------------------------------------------------------------------------
// namer.ts — AI-powered session naming via Haiku
//
// Calls claude-haiku-4-5-20251001 to generate a short, descriptive session
// name from the source/target document filenames, target title, and field labels.
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import { settings } from "./config.js";

const NAMING_MODEL = "claude-haiku-4-5-20251001";

/**
 * Call Haiku to produce a short, descriptive session name.
 *
 * Falls back to `targetTitle`, `targetFilename`, or `sourceDocumentFilename`
 * when the API key is missing
 * or the request fails.
 */
export async function generateSessionName(opts: {
  sourceDocumentFilename?: string | null;
  targetFilename?: string | null;
  targetTitle?: string | null;
  targetFieldLabels?: string[];
}): Promise<string> {
  const {
    sourceDocumentFilename,
    targetFilename,
    targetTitle,
    targetFieldLabels,
  } = opts;
  const fallback =
    targetTitle || targetFilename || sourceDocumentFilename || "Untitled Session";

  if (!settings.anthropic_api_key) {
    return fallback;
  }

  const contextParts: string[] = [];
  if (sourceDocumentFilename) {
    contextParts.push(`Source Document: ${sourceDocumentFilename}`);
  }
  if (targetFilename) {
    contextParts.push(`Target File: ${targetFilename}`);
  }
  if (targetTitle) {
    contextParts.push(`Target: ${targetTitle}`);
  }
  if (targetFieldLabels && targetFieldLabels.length > 0) {
    const preview = targetFieldLabels.slice(0, 8).join(", ");
    contextParts.push(`Fields: ${preview}`);
  }

  if (contextParts.length === 0) {
    return "Untitled Session";
  }

  const prompt =
    "Generate a short, descriptive name (max 6 words) for a questionnaire-answering session " +
    "based on the following context. Return ONLY the name, nothing else.\n\n" +
    contextParts.join("\n");

  try {
    const client = new Anthropic({ apiKey: settings.anthropic_api_key });
    const response = await client.messages.create({
      model: NAMING_MODEL,
      max_tokens: 30,
      temperature: 0.7,
      messages: [{ role: "user", content: prompt }],
    });

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
