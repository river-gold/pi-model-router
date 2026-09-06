export const CLASSIFIER_CHAIN_KEY = "classifier";

/** Session-permanent skips: broken auth / missing model. Not transient 5xx. */
export const RECORDABLE_PATTERNS: RegExp[] = [
  /Routed model not found/i,
  /No API key/i,
  /Auth failed/i,
];

/** Fallback when a 429 has no parseable reset time. */
export const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;

export const RESET_AT_RE = /resets at (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/i;
