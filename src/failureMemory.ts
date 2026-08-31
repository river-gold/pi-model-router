export const CLASSIFIER_CHAIN_KEY = 'classifier';

export const chainKeyForRoute = (profile: string, tier: string): string =>
  `route:${profile}:${tier}`;

export const normalizeFailedRef = (ref: string): string => ref.trim();

const RECORDABLE_PATTERNS: RegExp[] = [
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

export const isRecordablePreStreamError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  if (!msg) return false;
  if (msg.includes('aborted') || msg.includes('stale')) return false;
  if (msg.startsWith('NON_RETRYABLE:')) return false;
  return RECORDABLE_PATTERNS.some((p) => p.test(msg));
};
