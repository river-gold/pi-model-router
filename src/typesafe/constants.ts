export const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export const TYPESAFE_API_KEY_ENV = "TYPESAFE_API_KEY";

/** Question id for the tier Choice question (answer returned under the same id). */
export const TYPESAFE_TIER_QUESTION_ID = "tier";

export const DEFAULT_TYPESAFE_CONFIDENCE_THRESHOLD = 0.5;

export const TYPESAFE_TIMEOUT_MS = 10_000;

export const TYPESAFE_RETRY_BASE_MS = 250;

/** Docs: back off and retry only for rate limit / overload. */
export const TYPESAFE_RETRY_STATUS: readonly number[] = [429, 529];

export const TYPESAFE_ABORT_ERROR = "aborted";

export const TYPESAFE_MAX_ERROR_BODY_CHARS = 200;
