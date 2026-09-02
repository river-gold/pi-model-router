export const CLASSIFIER_CHAIN_KEY = "classifier";

export const RECORDABLE_PATTERNS: RegExp[] = [
  /Routed model not found/i,
  /No API key/i,
  /Auth failed/i,
  /\b429\b/,
  /rate.?limit/i,
  /quota/i,
  /\b5\d\d\b/,
  /server error/i,
  /Model failed before sending content/i,
  /No delegated stream/i,
  /overloaded/i,
  /unavailable/i,
];
