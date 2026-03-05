// ---------------------------------------------------------------------------
// anthropic-client.ts — Shared Anthropic SDK client
//
// Returns a singleton Anthropic client so that all concurrent sessions share
// the same underlying HTTP connection pool instead of each creating their own.
// The client is lazily created and re-created when the API key changes.
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import { settings } from "./config.js";

let _client: Anthropic | null = null;
let _clientKey: string = "";

/**
 * Return a shared Anthropic client for the current API key.
 *
 * If the key has changed since the last call (e.g. the user updated it in
 * Settings), a fresh client is created automatically.
 */
export function getAnthropicClient(): Anthropic {
  const key = settings.anthropic_api_key;
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  if (_client === null || key !== _clientKey) {
    _client = new Anthropic({ apiKey: key });
    _clientKey = key;
  }
  return _client;
}
