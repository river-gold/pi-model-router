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

/** TypeSafe state에 넣을 수 있는 history pair 하나의 최대 길이. */
export const TYPESAFE_MAX_HISTORY_PAIR_CHARS = 2_000;

/**
 * TypeSafe state.history 전체 최대 길이.
 * Jev는 state + 가장 긴 질문이 32,000 토큰(or state + 모든 질문 64,000 토큰)을 넘으면 400 max_tokens_exceeded를 반환함.
 * 한글 기준 8,000자는 대략 4~8k 토큰이라 한도 안에 여유를 두고 들어감.
 */
export const TYPESAFE_MAX_HISTORY_CHARS = 8_000;
