import { afterEach, describe, expect, it, vi } from "vitest";
import { callTypesafe } from "../../src/typesafe/client";
import type { TypesafeFetch, TypesafeHttpResponse } from "../../src/typesafe/client";
import { buildTypesafeRequest } from "../../src/typesafe/request";
import { TYPESAFE_ENDPOINT, TYPESAFE_RETRY_BASE_MS } from "../../src/typesafe/constants";

const request = buildTypesafeRequest({ message: "hi" });
const okBody = { answers: { tier: { type: "choice", choice: "low" } } };

const response = (status: number, body: string): TypesafeHttpResponse => ({
  status,
  text: async () => body,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("callTypesafe를 검증함", () => {
  it("2xx 응답은 JSON body로 파싱해서 반환함을 검증함", async () => {
    const fetchFn = vi.fn<TypesafeFetch>().mockResolvedValue(response(200, JSON.stringify(okBody)));
    const result = await callTypesafe({ request, apiKey: "key-1", fetchFn });
    expect(result).toEqual({ body: okBody });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(TYPESAFE_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer key-1");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual(request);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("4xx는 재시도하지 않고 에러를 반환함을 검증함", async () => {
    const fetchFn = vi.fn<TypesafeFetch>().mockResolvedValue(response(401, "unauthorized"));
    const result = await callTypesafe({ request, apiKey: "key-1", fetchFn, sleepFn: vi.fn() });
    expect(result).toEqual({
      error: "TypeSafe request failed (401): unauthorized",
      retryable: false,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("429는 지수 백오프로 한 번 재시도함을 검증함", async () => {
    const fetchFn = vi
      .fn<TypesafeFetch>()
      .mockResolvedValueOnce(response(429, "rate limited"))
      .mockResolvedValueOnce(response(200, JSON.stringify(okBody)));
    const sleepFn = vi.fn(async () => {});
    const result = await callTypesafe({ request, apiKey: "key-1", fetchFn, sleepFn });
    expect(result).toEqual({ body: okBody });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledWith(TYPESAFE_RETRY_BASE_MS);
  });

  it("429/5xx가 계속되면 재시도 가능 에러를 반환함을 검증함", async () => {
    const fetchFn = vi.fn<TypesafeFetch>().mockResolvedValue(response(529, "overloaded"));
    const result = await callTypesafe({ request, apiKey: "key-1", fetchFn, sleepFn: vi.fn() });
    expect(result).toEqual({
      error: "TypeSafe request failed (529): overloaded",
      retryable: true,
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("5xx도 재시도 대상임을 검증함", async () => {
    const fetchFn = vi
      .fn<TypesafeFetch>()
      .mockResolvedValueOnce(response(500, "boom"))
      .mockResolvedValueOnce(response(503, "down"));
    const result = await callTypesafe({ request, apiKey: "key-1", fetchFn, sleepFn: vi.fn() });
    expect(result).toEqual({ error: "TypeSafe request failed (503): down", retryable: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("네트워크 예외는 재시도하고 실패하면 에러 메시지로 감쌈을 검증함", async () => {
    const fetchFn = vi
      .fn<TypesafeFetch>()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockRejectedValueOnce("not-an-error");
    const result = await callTypesafe({ request, apiKey: "key-1", fetchFn, sleepFn: vi.fn() });
    expect(result).toEqual({ error: "TypeSafe request error: not-an-error", retryable: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("네트워크 예외 후 성공하면 body를 반환함을 검증함", async () => {
    const fetchFn = vi
      .fn<TypesafeFetch>()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce(response(200, JSON.stringify(okBody)));
    const result = await callTypesafe({ request, apiKey: "key-1", fetchFn, sleepFn: vi.fn() });
    expect(result).toEqual({ body: okBody });
  });

  it("signal이 abort되면 재시도하지 않음을 검증함", async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn<TypesafeFetch>(async () => {
      controller.abort();
      return response(429, "rate limited");
    });
    const result = await callTypesafe({
      request,
      apiKey: "key-1",
      fetchFn,
      sleepFn: vi.fn(),
      signal: controller.signal,
    });
    expect(result).toEqual({
      error: "TypeSafe request failed (429): rate limited",
      retryable: true,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("abort된 signal에서 예외가 발생하면 aborted 에러를 반환함을 검증함", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchFn = vi.fn<TypesafeFetch>().mockRejectedValue(new Error("aborted"));
    const result = await callTypesafe({
      request,
      apiKey: "key-1",
      fetchFn,
      signal: controller.signal,
    });
    expect(result).toEqual({ error: "aborted", retryable: false });
  });

  it("긴 에러 본문은 잘라서 표시함을 검증함", async () => {
    const fetchFn = vi.fn<TypesafeFetch>().mockResolvedValue(response(422, `x`.repeat(200)));
    const short = await callTypesafe({ request, apiKey: "key-1", fetchFn });
    expect(short).toEqual({
      error: `TypeSafe request failed (422): ${"x".repeat(200)}`,
      retryable: false,
    });

    const longBody = "y".repeat(250);
    const longFetch = vi.fn<TypesafeFetch>().mockResolvedValue(response(422, longBody));
    const long = await callTypesafe({ request, apiKey: "key-1", fetchFn: longFetch });
    expect(long).toEqual({
      error: `TypeSafe request failed (422): ${"y".repeat(200)}…`,
      retryable: false,
    });
  });

  it("기본 fetch/sleep을 사용함을 검증함", async () => {
    const globalFetch = vi
      .fn()
      .mockResolvedValueOnce(response(429, "rate limited"))
      .mockResolvedValueOnce(response(200, JSON.stringify(okBody)));
    vi.stubGlobal("fetch", globalFetch);
    const result = await callTypesafe({ request, apiKey: "key-2" });
    expect(result).toEqual({ body: okBody });
    expect(globalFetch).toHaveBeenCalledTimes(2);
    expect(globalFetch.mock.calls[0]![0]).toBe(TYPESAFE_ENDPOINT);
  });
});
