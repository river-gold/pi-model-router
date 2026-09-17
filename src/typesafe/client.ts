import {
  TYPESAFE_ABORT_ERROR,
  TYPESAFE_ENDPOINT,
  TYPESAFE_MAX_ERROR_BODY_CHARS,
  TYPESAFE_RETRY_BASE_MS,
  TYPESAFE_RETRY_STATUS,
  TYPESAFE_TIMEOUT_MS,
} from "./constants";
import type { TypesafeCallOutcome, TypesafeRequest } from "./types";

export interface TypesafeHttpResponse {
  status: number;
  text: () => Promise<string>;
}

export type TypesafeFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<TypesafeHttpResponse>;

export type TypesafeSleep = (ms: number) => Promise<void>;

const defaultFetch: TypesafeFetch = (url, init) => globalThis.fetch(url, init);

const defaultSleep: TypesafeSleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** 유저 abort와 타임아웃을 함께 걸어둠 (타임아웃 시 유저 signal은 abort 상태가 아님). */
const requestSignal = (signal: AbortSignal | undefined): AbortSignal =>
  signal
    ? AbortSignal.any([signal, AbortSignal.timeout(TYPESAFE_TIMEOUT_MS)])
    : AbortSignal.timeout(TYPESAFE_TIMEOUT_MS);

const isRetryableStatus = (status: number): boolean =>
  TYPESAFE_RETRY_STATUS.includes(status) || status >= 500;

const describeBody = (text: string): string =>
  text.length > TYPESAFE_MAX_ERROR_BODY_CHARS
    ? `${text.slice(0, TYPESAFE_MAX_ERROR_BODY_CHARS)}…`
    : text;

const postOnce = async (
  fetchFn: TypesafeFetch,
  params: { request: TypesafeRequest; apiKey: string; signal?: AbortSignal | undefined },
): Promise<TypesafeCallOutcome> => {
  try {
    const response = await fetchFn(TYPESAFE_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${params.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(params.request),
      signal: requestSignal(params.signal),
    });
    const text = await response.text();
    if (response.status < 200 || response.status >= 300) {
      return {
        error: `TypeSafe request failed (${response.status}): ${describeBody(text)}`,
        retryable: isRetryableStatus(response.status),
      };
    }
    return { body: JSON.parse(text) as unknown };
  } catch (error) {
    if (params.signal?.aborted) return { error: TYPESAFE_ABORT_ERROR, retryable: false };
    const message = error instanceof Error ? error.message : String(error);
    return { error: `TypeSafe request error: ${message}`, retryable: true };
  }
};

/**
 * 429/529(및 5xx)는 문서 권고대로 지수 백오프로 한 번 더 시도함.
 * 분류는 매 턴 임계 경로라 재시도 횟수를 1회로 제한함.
 */
export const callTypesafe = async (params: {
  request: TypesafeRequest;
  apiKey: string;
  signal?: AbortSignal;
  fetchFn?: TypesafeFetch;
  sleepFn?: TypesafeSleep;
}): Promise<TypesafeCallOutcome> => {
  const fetchFn = params.fetchFn ?? defaultFetch;
  const sleepFn = params.sleepFn ?? defaultSleep;
  const first = await postOnce(fetchFn, params);
  if ("body" in first || !first.retryable || params.signal?.aborted) return first;
  await sleepFn(TYPESAFE_RETRY_BASE_MS);
  return postOnce(fetchFn, params);
};
