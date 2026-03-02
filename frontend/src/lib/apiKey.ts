const ANTHROPIC_KEY_PREFIX = "sk-ant-";
const MIN_KEY_LENGTH = 20;

const INVALID_KEY_MESSAGE =
  'Invalid key format. Anthropic API keys start with "sk-ant-" and are at least 20 characters.';

export interface ApiKeyValidationResult {
  normalizedKey: string;
  error: string | null;
}

export function validateAnthropicApiKey(input: string): ApiKeyValidationResult {
  const normalizedKey = input.trim();
  if (
    !normalizedKey.startsWith(ANTHROPIC_KEY_PREFIX) ||
    normalizedKey.length < MIN_KEY_LENGTH
  ) {
    return {
      normalizedKey,
      error: INVALID_KEY_MESSAGE,
    };
  }

  return {
    normalizedKey,
    error: null,
  };
}
