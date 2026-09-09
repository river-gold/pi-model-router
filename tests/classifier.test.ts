import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseClassifierOutput, runClassifierWithFallbacksDetailed } from "../src/classifier";
import type { Context } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
const streamSimple = vi.fn();
const makeRegistry = (over: Record<string, unknown> = {}) =>
  ({
    find: vi.fn((p: string, m: string) => {
      const fn = over.find as ((a: string, b: string) => unknown) | undefined;
      if (fn) return fn(p, m);
      if (p === "openai" && m === "plain") return { provider: p, id: m, baseUrl: "" } as never;
      return { provider: p, id: m, reasoning: true, baseUrl: "" } as never;
    }),
    getApiKeyAndHeaders: vi.fn(async () => {
      const fn = over.getApiKeyAndHeaders as ((m: unknown) => Promise<unknown>) | undefined;
      if (fn) return fn({});
      return { ok: true, apiKey: "k", headers: {} };
    }),
    getProvider: () => ({ streamSimple }),
  }) as unknown as ExtensionContext["modelRegistry"];
const baseCtx: Context = { messages: [{ role: "user", content: "hello", timestamp: 1 }] };
describe("parseClassifierOutput 함수는", () => {
  it("유효한 tier가 주어지면 tier를 반환한다", () => {
    expect(parseClassifierOutput("low")?.tier).toBe("low");
  });
  it("대소문자와 공백이 있으면 정규화한다", () => {
    expect(parseClassifierOutput("  HIGH  ")?.tier).toBe("high");
  });
  it("빈 입력이면 undefined를 반환한다", () => {
    expect(parseClassifierOutput("   ")).toBeUndefined();
  });
  it("유효하지 않은 입력이면 undefined를 반환한다", () => {
    expect(parseClassifierOutput("invalid")).toBeUndefined();
  });
});
describe("runClassifierWithFallbacksDetailed 함수는", () => {
  beforeEach(() => vi.clearAllMocks());
  it("유효한 스트림이 주어지면 tier를 반환한다", async () => {
    const reg = makeRegistry();
    streamSimple.mockReturnValue(
      (async function* () {
        yield { type: "text_delta", delta: "high" };
      })() as never,
    );
    expect(
      (await runClassifierWithFallbacksDetailed([{ model: "openai/gpt" }], reg, baseCtx, 0)).result
        ?.tier,
    ).toBe("high");
  });
  it("파싱 실패 시 retryable로 처리한다", async () => {
    const reg = makeRegistry();
    streamSimple.mockReturnValue(
      (async function* () {
        yield { type: "text_delta", delta: "bad" };
      })() as never,
    );
    const failed = new Set<string>();
    const res = await runClassifierWithFallbacksDetailed(
      [{ model: "openai/gpt" }],
      reg,
      baseCtx,
      0,
      undefined,
      undefined,
      failed,
    );
    expect(res.result).toBeUndefined();
    expect(failed.size).toBe(0);
    expect(res.attempts[0].error).toContain("no tier parsed");
  });
  it("모델을 찾을 수 없으면 세션에서 skipped 처리한다", async () => {
    const reg = makeRegistry({ find: () => undefined });
    const failed = new Set<string>();
    const res = await runClassifierWithFallbacksDetailed(
      [{ model: "openai/missing" }],
      reg,
      baseCtx,
      0,
      undefined,
      undefined,
      failed,
    );
    expect(res.attempts[0].error).toContain("model not found");
    expect(failed.has("openai/missing")).toBe(true);
  });
  it("auth 결과 ok가 false이면 에러를 반환한다", async () => {
    const reg = makeRegistry({ getApiKeyAndHeaders: async () => ({ ok: false }) });
    expect(
      (await runClassifierWithFallbacksDetailed([{ model: "openai/gpt" }], reg, baseCtx, 0))
        .attempts[0].error,
    ).toContain("auth failed");
  });
  it("apiKey가 비어 있으면 hasKey=false 에러를 반환한다", async () => {
    const reg = makeRegistry({
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "", headers: {} }),
    });
    expect(
      (await runClassifierWithFallbacksDetailed([{ model: "openai/gpt" }], reg, baseCtx, 0))
        .attempts[0].error,
    ).toContain("hasKey=false");
  });
  it("fallback 체인에서는 두 번째 모델로 성공한다", async () => {
    const reg = makeRegistry();
    const s1 = (async function* () {
      yield { type: "text_delta", delta: "bad" };
    })();
    const s2 = (async function* () {
      yield { type: "text_delta", delta: "low" };
    })();
    streamSimple.mockReturnValueOnce(s1 as never).mockReturnValueOnce(s2 as never);
    expect(
      (
        await runClassifierWithFallbacksDetailed(
          [{ model: "openai/gpt" }, { model: "openai/gpt" }],
          reg,
          baseCtx,
          0,
        )
      ).result?.tier,
    ).toBe("low");
  });
  it("failedSet에 모델이 있으면 skipped 처리한다", async () => {
    const reg = makeRegistry();
    const failed = new Set(["openai/gpt"]);
    expect(
      (
        await runClassifierWithFallbacksDetailed(
          [{ model: "openai/gpt" }],
          reg,
          baseCtx,
          0,
          undefined,
          undefined,
          failed,
        )
      ).attempts[0].error,
    ).toContain("skipped");
  });
  it("aborted 시그널이면 aborted를 반환한다", async () => {
    const reg = makeRegistry();
    streamSimple.mockImplementation(() => {
      throw new Error("boom");
    });
    const c = new AbortController();
    c.abort();
    expect(
      (
        await runClassifierWithFallbacksDetailed(
          [{ model: "openai/gpt" }],
          reg,
          baseCtx,
          0,
          c.signal,
        )
      ).attempts[0].error,
    ).toBe("aborted");
  });
  it("Error가 아닌 throw는 문자열 에러로 반환한다", async () => {
    const reg = makeRegistry();
    streamSimple.mockImplementation(() => {
      throw "string thrown";
    });
    expect(
      (await runClassifierWithFallbacksDetailed([{ model: "openai/gpt" }], reg, baseCtx, 0))
        .attempts[0].error,
    ).toBe("string thrown");
  });
  it("혼합 이벤트에서는 유효한 delta만 파싱한다", async () => {
    const reg = makeRegistry();
    const s = (async function* () {
      yield { type: "other" } as never;
      yield { type: "text_delta", delta: 123 } as never;
      yield { type: "text_delta", delta: "medium" } as never;
    })();
    streamSimple.mockReturnValue(s as never);
    expect(
      (await runClassifierWithFallbacksDetailed([{ model: "openai/gpt" }], reg, baseCtx, 0)).result
        ?.tier,
    ).toBe("medium");
  });
  it("null 이벤트는 무시한다", async () => {
    const reg = makeRegistry();
    const s = (async function* () {
      yield null as never;
      yield { type: "text_delta", delta: "low" } as never;
    })();
    streamSimple.mockReturnValue(s as never);
    expect(
      (await runClassifierWithFallbacksDetailed([{ model: "openai/gpt" }], reg, baseCtx, 0)).result
        ?.tier,
    ).toBe("low");
  });
  it("Error throw 시 메시지를 반환한다", async () => {
    const reg = makeRegistry();
    streamSimple.mockImplementation(() => {
      throw new Error("stream fail");
    });
    expect(
      (await runClassifierWithFallbacksDetailed([{ model: "openai/gpt" }], reg, baseCtx, 0))
        .attempts[0].error,
    ).toBe("stream fail");
  });
  it("reasoning이 off인 reasoning 모델도 성공한다", async () => {
    const reg = makeRegistry();
    streamSimple.mockReturnValue(
      (async function* () {
        yield { type: "text_delta", delta: "low" };
      })() as never,
    );
    expect(
      (
        await runClassifierWithFallbacksDetailed(
          [{ model: "openai/gpt", thinking: "off" as never }],
          reg,
          baseCtx,
          0,
        )
      ).result?.tier,
    ).toBe("low");
  });
  it("history가 주어져도 성공한다", async () => {
    const reg = makeRegistry();
    streamSimple.mockReturnValue(
      (async function* () {
        yield { type: "text_delta", delta: "low" };
      })() as never,
    );
    const histCtx: Context = {
      messages: [
        { role: "user", content: "u1", timestamp: 1 },
        { role: "assistant", content: "a1", timestamp: 2 } as never,
        { role: "user", content: "cur", timestamp: 3 },
      ],
    };
    expect(
      (
        await runClassifierWithFallbacksDetailed(
          [{ model: "openai/gpt", thinking: "high" as never }],
          reg,
          histCtx,
          1,
        )
      ).result?.tier,
    ).toBe("low");
    streamSimple.mockReturnValue(
      (async function* () {
        yield { type: "text_delta", delta: "low" };
      })() as never,
    );
    const singleCtx: Context = { messages: [{ role: "user", content: "cur", timestamp: 1 }] };
    expect(
      (
        await runClassifierWithFallbacksDetailed(
          [{ model: "openai/plain", thinking: "off" as never }],
          reg,
          singleCtx,
          1,
        )
      ).result?.tier,
    ).toBe("low");
  });
  it("custom tierGuides가 주어지면 systemPrompt에 override가 반영된다", async () => {
    const reg = makeRegistry();
    streamSimple.mockReturnValue(
      (async function* () {
        yield { type: "text_delta", delta: "low" };
      })() as never,
    );
    const res = await runClassifierWithFallbacksDetailed(
      [{ model: "openai/gpt" }],
      reg,
      baseCtx,
      0,
      undefined,
      undefined,
      undefined,
      { low: "custom low guide" },
    );
    expect(res.result?.tier).toBe("low");
    const sentContext = streamSimple.mock.calls[0][1] as Context;
    expect(sentContext.systemPrompt).toContain("- low: custom low guide");
    expect(sentContext.systemPrompt).toContain("- high: Local design under uncertainty");
  });
  it("opencode-go classifier에 sessionId가 있으면 세션 헤더를 주입한다", async () => {
    const reg = makeRegistry();
    streamSimple.mockReturnValue(
      (async function* () {
        yield { type: "text_delta", delta: "high" };
      })() as never,
    );
    const res = await runClassifierWithFallbacksDetailed(
      [{ model: "opencode-go/muse-spark-1.3-contributor" }],
      reg,
      baseCtx,
      0,
      undefined,
      undefined,
      undefined,
      undefined,
      "sess-9",
    );
    expect(res.result?.tier).toBe("high");
    const sentOptions = streamSimple.mock.calls[0][2] as { headers: Record<string, string> };
    expect(sentOptions.headers).toEqual({
      "x-opencode-session": "sess-9",
      "x-opencode-client": "pi",
    });
  });
  it("sessionId가 없으면 세션 헤더를 주입하지 않는다", async () => {
    const reg = makeRegistry();
    streamSimple.mockReturnValue(
      (async function* () {
        yield { type: "text_delta", delta: "high" };
      })() as never,
    );
    const res = await runClassifierWithFallbacksDetailed(
      [{ model: "opencode-go/muse-spark-1.3-contributor" }],
      reg,
      baseCtx,
      0,
    );
    expect(res.result?.tier).toBe("high");
    const sentOptions = streamSimple.mock.calls[0][2] as { headers: Record<string, string> };
    expect(sentOptions.headers).not.toHaveProperty("x-opencode-session");
  });
});
