import { RECORDABLE_PATTERNS } from "./constants";

export const isNonRetryableMessage = (msg: string): boolean => msg.startsWith("NON_RETRYABLE:");

export const isAbortedOrStaleMessage = (msg: string): boolean =>
  msg.includes("aborted") || msg.includes("stale");

export const matchesRecordablePattern = (msg: string): boolean =>
  RECORDABLE_PATTERNS.some((p) => p.test(msg));

export const isRecordablePreStreamError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  if (!msg) return false;
  if (isAbortedOrStaleMessage(msg)) return false;
  if (isNonRetryableMessage(msg)) return false;
  return matchesRecordablePattern(msg);
};
