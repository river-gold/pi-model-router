import { RATE_LIMIT_COOLDOWN_MS, RESET_AT_RE } from "./constants";
import { isRecordablePreStreamError } from "./isRecordable";
import { normalizeFailedRef } from "./normalize";

const cooldowns = new Map<string, number>();

const cooldownId = (chainKey: string, ref: string): string =>
  `${chainKey}\0${normalizeFailedRef(ref)}`;

export const errorText = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") return JSON.stringify(error);
  return String(error);
};

const isRateLimit = (text: string): boolean =>
  /\b429\b/.test(text) || /RATE_LIMITED/i.test(text) || /rate_limit_error/i.test(text);

/** `null` = not a rate-limit cooldown. */
export const failureCooldownUntil = (error: unknown, now = Date.now()): number | null => {
  const text = errorText(error);
  if (!isRateLimit(text)) return null;
  const iso = text.match(RESET_AT_RE)?.[1];
  if (iso) {
    const parsed = Date.parse(iso);
    if (!Number.isNaN(parsed)) return parsed > now ? parsed : null;
  }
  return now + RATE_LIMIT_COOLDOWN_MS;
};

export const recordRateLimitCooldown = (chainKey: string, ref: string, untilMs: number): void => {
  const id = cooldownId(chainKey, ref);
  cooldowns.set(id, Math.max(cooldowns.get(id) ?? 0, untilMs));
};

export const liveRateLimitedRefs = (chainKey: string, now = Date.now()): Set<string> => {
  const prefix = `${chainKey}\0`;
  const live = new Set<string>();
  for (const [id, until] of cooldowns) {
    if (!id.startsWith(prefix)) continue;
    if (until > now) live.add(id.slice(prefix.length));
    else cooldowns.delete(id);
  }
  return live;
};

export const clearRateLimitCooldowns = (): void => {
  cooldowns.clear();
};

export const failedRefsForChain = (
  session: Set<string> | undefined,
  chainKey: string,
  now = Date.now(),
): Set<string> | undefined => {
  const limited = liveRateLimitedRefs(chainKey, now);
  if (!session?.size && limited.size === 0) return undefined;
  return new Set<string>([...(session ?? []), ...limited]);
};

export const rememberPreStreamFailure = (
  err: unknown,
  ref: string,
  recordSessionFailure: (ref: string) => void,
  chainKey: string,
  now = Date.now(),
): void => {
  const until = failureCooldownUntil(err, now);
  if (until !== null) {
    recordRateLimitCooldown(chainKey, ref, until);
    return;
  }
  if (isRecordablePreStreamError(err)) recordSessionFailure(ref);
};
