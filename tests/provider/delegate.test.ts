/* oxlint-disable */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getInitialModelsToTry,
  filterByFailureMemory,
  createRecordFailure,
  resolveTargetLimit,
  buildEffectiveContext,
  isContentEvent,
  collectBufferedResult,
  resolveAuthError,
  shouldSkipRouterModel,
  buildFallbackDecision,
  attemptSingleModel,
  delegateToTierModels,
  toDelegateResult,
} from "../../src/provider/delegate";
import type { RouterProfile, RoutingDecision } from "../../src/types";
import { streamDelegated } from "../../src/stream";
import { clearRateLimitCooldowns, liveRateLimitedRefs } from "../../src/failureMemory";

vi.mock("../../src/stream", async () => {
  const actual = (await vi.importActual("../../src/stream")) as any;
  return { ...actual, streamDelegated: vi.fn(), modelWithAuthBaseUrl: actual.modelWithAuthBaseUrl };
});

const profile = (over: Partial<RouterProfile> = {}): RouterProfile => ({
  high: { models: ["openai/gpt-high"], resolvedContextWindow: 1000 } as any,
  medium: { models: ["openai/gpt-medium"], resolvedContextWindow: 800 } as any,
  ...over,
});
const decision = (over: Partial<RoutingDecision> = {}): RoutingDecision =>
  ({
    profile: "balanced",
    tier: "high",
    targetProvider: "openai",
    targetModelId: "gpt-high",
    targetLabel: "openai/gpt-high",
    reasoning: "r",
    thinking: "high",
    timestamp: Date.now(),
    ...over,
  }) as any;

describe("delegate 순수 헬퍼 함수들", () => {
  it("getInitialModelsToTry 중복 제거", () => {
    expect(
      getInitialModelsToTry(
        profile({ high: { models: ["a/b", "a/b"] } as any }),
        decision({ tier: "high" }),
      ),
    ).toEqual(["a/b"]);
  });
  it("getInitialModelsToTry tier가 undefined인 경우", () => {
    expect(
      getInitialModelsToTry(
        profile({ high: undefined }),
        decision({ tier: "high", targetProvider: "openai", targetModelId: "gpt" }),
      ),
    ).toEqual(["openai/gpt#high"]);
  });
  it("getInitialModelsToTry tier가 비어 있는 경우", () => {
    expect(
      getInitialModelsToTry(
        profile({ high: { models: [] } as any }),
        decision({ tier: "high", targetProvider: "openai", targetModelId: "gpt" }),
      ),
    ).toEqual(["openai/gpt#high"]);
  });
  it("filterByFailureMemory 실패 기억으로 필터링", () => {
    expect(filterByFailureMemory(["a/b"], undefined).filtered).toEqual(["a/b"]);
    expect(filterByFailureMemory(["a/b"], new Set()).filtered).toEqual(["a/b"]);
    expect(filterByFailureMemory(["a/b", "c/d"], new Set(["a/b"]))).toEqual({
      filtered: ["c/d"],
      skipped: ["a/b"],
      allFiltered: false,
    });
    expect(filterByFailureMemory(["a/b"], new Set(["a/b"])).allFiltered).toBe(true);
    expect(filterByFailureMemory([], new Set(["a/b"])).allFiltered).toBe(false);
  });
  it("createRecordFailure 실패 기록 생성", () => {
    const state: any = { failedByChain: new Map() };
    const rec = createRecordFailure(state, "route:balanced:high");
    rec("a/b");
    expect(state.failedByChain.get("route:balanced:high")!.has("a/b")).toBe(true);
    rec("a/b");
    expect(state.failedByChain.get("route:balanced:high")!.size).toBe(1);
  });
  it("resolveTargetLimit 대상 limit 결정", () => {
    const p = profile({ high: { models: ["openai/gpt-high"] } as any });
    expect(
      typeof resolveTargetLimit(
        p,
        decision({ tier: "high" }),
        "openai/gpt-high",
        { find: vi.fn() } as any,
        "openai",
        "gpt-high",
      ),
    ).toBe("number");
    expect(
      typeof resolveTargetLimit(
        { high: undefined } as any,
        decision({ tier: "high" }),
        "x",
        { find: () => ({ contextWindow: 500 }) as any } as any,
        "x",
        "y",
      ),
    ).toBe("number");
    expect(
      typeof resolveTargetLimit(
        { high: undefined } as any,
        decision({ tier: "high" }),
        "x",
        { find: () => undefined } as any,
        "x",
        "y",
      ),
    ).toBe("number");
    expect(
      typeof resolveTargetLimit(
        profile({
          high: { models: ["openai/gpt-high"] } as any,
          medium: { models: ["openai/gpt-medium"] } as any,
        }),
        decision({ tier: "high" }),
        "openai/gpt-medium",
        { find: vi.fn() } as any,
        "openai",
        "gpt-medium",
      ),
    ).toBe("number");
    expect(
      typeof resolveTargetLimit(
        { high: { models: undefined } as any } as any,
        decision({ tier: "high" }),
        "x",
        { find: () => undefined } as any,
        "x",
        "y",
      ),
    ).toBe("number");
    expect(
      typeof resolveTargetLimit(
        { high: undefined } as any,
        decision({ tier: "high" }),
        "x",
        { find: () => ({}) as any } as any,
        "x",
        "y",
      ),
    ).toBe("number");
  });
  it("buildEffectiveContext 유효 context 구성", () => {
    const small: any = { messages: [{ role: "user", content: "hi", timestamp: 1 }] };
    const large: any = {
      messages: [
        { role: "user", content: "a".repeat(5000), timestamp: 1 },
        { role: "assistant", content: "b".repeat(5000), timestamp: 2 },
      ],
    };
    expect(buildEffectiveContext(large, 50, { contextWindow: 100 } as any)).not.toBe(large);
    expect(buildEffectiveContext(small, 200, { contextWindow: 100 } as any)).toBe(small);
    expect(buildEffectiveContext(small, 10, {} as any)).toBe(small);
  });
  it("isContentEvent와 collectBufferedResult 동작", () => {
    expect(isContentEvent("text_delta")).toBe(true);
    expect(isContentEvent("done")).toBe(false);
    expect(
      collectBufferedResult([{ type: "done", message: { usage: { cost: { total: 0.5 } } } }])
        .pendingCostDelta,
    ).toBe(0.5);
    expect(
      collectBufferedResult([{ type: "error", error: { errorMessage: "e" } }]).bufferedErrorMessage,
    ).toBe("e");
    expect(collectBufferedResult([{ type: "text_delta" }]).contentReceived).toBe(true);
    expect(collectBufferedResult([]).gotDone).toBe(false);
    expect(collectBufferedResult([{ type: "done" }]).pendingCostDelta).toBe(0);
    expect(collectBufferedResult([{ type: "error" }]).bufferedErrorMessage).toBeUndefined();
    expect(
      collectBufferedResult([{ type: "error", error: { errorMessage: 1 } }]).bufferedErrorMessage,
    ).toBeUndefined();
    expect(
      collectBufferedResult([{ type: "error", error: {} }]).bufferedErrorMessage,
    ).toBeUndefined();
    const r = collectBufferedResult([
      { type: "done", message: { usage: { cost: { total: 1 } } } },
      { type: "error", error: { errorMessage: "e" } },
      { type: "text_delta" },
    ]);
    expect(r.gotDone && r.gotError && r.contentReceived).toBe(true);
  });
  it("resolveAuthError와 shouldSkip 동작", () => {
    expect(resolveAuthError({ ok: false, error: "bad" } as any, "openai", "gpt").message).toContain(
      "Auth failed",
    );
    expect(resolveAuthError({ ok: true } as any, "openai", "gpt").message).toContain("No API key");
    expect(shouldSkipRouterModel("router")).toBe(true);
    expect(shouldSkipRouterModel("openai")).toBe(false);
  });
  it("buildFallbackDecision 폴백 decision 구성", () => {
    const d = decision({ thinking: "high" });
    buildFallbackDecision(d, "anthropic/claude#low");
    expect(d.isFallback && d.targetProvider === "anthropic" && d.thinking === "low").toBe(true);
    const d2 = decision({ thinking: "high" });
    buildFallbackDecision(d2, "openai/gpt");
    expect(d2.thinking).toBe("high");
  });
});

describe("attemptSingleModel 단일 모델 시도", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => clearRateLimitCooldowns());
  const base = (over: any = {}) => ({
    registry: {
      find: vi.fn(() => ({ provider: "openai", id: "gpt-high", reasoning: false }) as any),
      getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "k", headers: {} })),
    } as any,
    profile: profile({ high: { models: ["openai/gpt-high"] } as any }),
    decision: decision({ tier: "high" }),
    routerModel: { contextWindow: 10000 } as any,
    context: { messages: [] } as any,
    state: {
      failedByChain: new Map(),
      lastDecision: undefined,
      accumulatedCost: 0,
      lastExtensionContext: undefined,
    } as any,
    withCommitMutex: async (fn: any) => fn(),
    stream: { push: vi.fn() } as any,
    recordDebugDecision: vi.fn(),
    ...over,
  });
  it("router 모델은 skip", async () =>
    expect((await attemptSingleModel("router/balanced", 0, base() as any, vi.fn())).status).toBe(
      "skip",
    ));
  it("model을 찾지 못하면 retry", async () =>
    expect(
      (
        await attemptSingleModel(
          "openai/missing",
          0,
          base({ registry: { find: () => undefined, getApiKeyAndHeaders: vi.fn() } as any }) as any,
          vi.fn(),
        )
      ).status,
    ).toBe("retry"));
  it("auth 실패 시 retry", async () => {
    const p = base({
      registry: {
        find: () => ({ provider: "openai", id: "gpt-high" }) as any,
        getApiKeyAndHeaders: async () => ({ ok: false, error: "bad" }) as any,
      } as any,
    });
    expect((await attemptSingleModel("openai/gpt-high", 0, p as any, vi.fn())).status).toBe(
      "retry",
    );
  });
  it("stream 전에 aborted면 nonRetryable", async () =>
    expect(
      (
        await attemptSingleModel(
          "openai/gpt-high",
          0,
          base({ options: { signal: { aborted: true } as any } as any }) as any,
          vi.fn(),
        )
      ).status,
    ).toBe("nonRetryable"));
  it("성공 시 stale UI 처리", async () => {
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          yield { type: "done", message: { usage: { cost: { total: 0.02 } } } };
        })() as any,
    );
    const s: any = {
      failedByChain: new Map(),
      lastDecision: { profile: "balanced" } as any,
      accumulatedCost: 0,
      lastExtensionContext: { ui: { setHiddenThinkingLabel: vi.fn() } },
    };
    const r = await attemptSingleModel("openai/gpt-high", 1, base({ state: s }) as any, vi.fn());
    expect(r.status).toBe("success");
    expect(r.costDelta).toBe(0.02);
  });
  it("stale UI throw 시에도 성공", async () => {
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          yield { type: "done", message: { usage: { cost: { total: 0 } } } };
        })() as any,
    );
    const s: any = {
      failedByChain: new Map(),
      lastDecision: undefined,
      accumulatedCost: 0,
      lastExtensionContext: {
        ui: {
          setHiddenThinkingLabel: () => {
            throw new Error("stale");
          },
        },
      },
    };
    expect(
      (await attemptSingleModel("openai/gpt-high", 0, base({ state: s }) as any, vi.fn())).status,
    ).toBe("success");
  });
  it("reasoning이 true인 경우", async () => {
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          yield { type: "done", message: { usage: { cost: { total: 0 } } } };
        })() as any,
    );
    const s: any = {
      failedByChain: new Map(),
      lastDecision: undefined,
      accumulatedCost: 0,
      lastExtensionContext: { ui: { setHiddenThinkingLabel: vi.fn() } },
    };
    expect(
      (
        await attemptSingleModel(
          "openai/gpt-high",
          0,
          base({
            state: s,
            decision: decision({ tier: "high", thinking: "high" }),
            registry: {
              find: () => ({ provider: "openai", id: "gpt-high", reasoning: true }) as any,
              getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }) as any,
            } as any,
          }) as any,
          vi.fn(),
        )
      ).status,
    ).toBe("success");
  });
  it("stream 도중 aborted면 nonRetryable", async () => {
    const signal: any = { aborted: false };
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          yield { type: "text_delta" };
          signal.aborted = true;
          yield { type: "text_delta" };
        })() as any,
    );
    expect(
      (
        await attemptSingleModel(
          "openai/gpt-high",
          0,
          base({ options: { signal } as any }) as any,
          vi.fn(),
        )
      ).status,
    ).toBe("nonRetryable");
  });
  it("stream의 non-abort throw는 전파", async () => {
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          throw new Error("boom");
        })() as any,
    );
    await expect(attemptSingleModel("openai/gpt-high", 0, base() as any, vi.fn())).rejects.toThrow(
      "boom",
    );
  });
  it("content 전송 후 gotError면 nonRetryable", async () => {
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          yield { type: "text_delta" };
          yield { type: "error", error: { errorMessage: "fail" } };
        })() as any,
    );
    expect((await attemptSingleModel("openai/gpt-high", 0, base() as any, vi.fn())).status).toBe(
      "nonRetryable",
    );
  });
  it("content 없이 gotError면 retry", async () => {
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          yield { type: "error", error: { errorMessage: "fail" } };
        })() as any,
    );
    expect((await attemptSingleModel("openai/gpt-high", 0, base() as any, vi.fn())).status).toBe(
      "retry",
    );
  });
  it("delegated stream이 없으면 retry", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => null as any);
    expect((await attemptSingleModel("openai/gpt-high", 0, base() as any, vi.fn())).status).toBe(
      "retry",
    );
  });
  it("terminal event가 없으면 retry", async () => {
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          yield { type: "text_delta" };
        })() as any,
    );
    expect((await attemptSingleModel("openai/gpt-high", 0, base() as any, vi.fn())).status).toBe(
      "retry",
    );
  });
  it("model을 찾지 못하면 session 실패 기록", async () => {
    const rec = vi.fn();
    expect(
      (
        await attemptSingleModel(
          "openai/missing",
          0,
          base({ registry: { find: () => undefined, getApiKeyAndHeaders: vi.fn() } as any }) as any,
          rec,
        )
      ).status,
    ).toBe("retry");
    expect(rec).toHaveBeenCalled();
  });
  it("apiKey 없이 auth ok면 retry", async () => {
    const rec = vi.fn();
    const p = base({
      registry: {
        find: () => ({ provider: "openai", id: "gpt-high" }) as any,
        getApiKeyAndHeaders: async () => ({ ok: true }) as any,
      } as any,
    });
    expect((await attemptSingleModel("openai/gpt-high", 0, p as any, rec)).status).toBe("retry");
    expect(rec).toHaveBeenCalled();
  });
  it("auth 실패 시 session 실패 기록", async () => {
    const rec = vi.fn();
    const p = base({
      registry: {
        find: () => ({ provider: "openai", id: "gpt-high" }) as any,
        getApiKeyAndHeaders: async () => ({ ok: false, error: "bad" }) as any,
      } as any,
    });
    expect((await attemptSingleModel("openai/gpt-high", 0, p as any, rec)).status).toBe("retry");
    expect(rec).toHaveBeenCalled();
  });
  it("delegated stream이 없으면 session 실패 기록 안 함", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => null as any);
    const rec = vi.fn();
    expect((await attemptSingleModel("openai/gpt-high", 0, base() as any, rec)).status).toBe(
      "retry",
    );
    expect(rec).not.toHaveBeenCalled();
  });
  it("message 없이 content 전송 후 gotError 처리", async () => {
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          yield { type: "text_delta" };
          yield { type: "error" };
        })() as any,
    );
    const r = await attemptSingleModel("openai/gpt-high", 0, base() as any, vi.fn());
    expect(r.status).toBe("nonRetryable");
    expect(r.error?.message).toContain("Model failed after sending content.");
  });
  it("gotError 429는 해당 model만 cooldown", async () => {
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          yield {
            type: "error",
            error: {
              errorMessage:
                '429: {"message":"limit resets at 2099-01-01T00:00:00.000Z.","type":"rate_limit_error","code":"RATE_LIMITED"}',
            },
          };
        })() as any,
    );
    const rec = vi.fn();
    const r = await attemptSingleModel("commandcode/m", 0, base() as any, rec);
    expect(r.status).toBe("retry");
    expect(rec).not.toHaveBeenCalled();
    expect(liveRateLimitedRefs("route:balanced:high").has("commandcode/m")).toBe(true);
  });
  it("message 없이 content 없는 gotError는 기록 안 함", async () => {
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          yield { type: "error" };
        })() as any,
    );
    const rec = vi.fn();
    const r = await attemptSingleModel("openai/gpt-high", 0, base() as any, rec);
    expect(r.status).toBe("retry");
    expect(r.error?.message).toBe("Model failed before sending content.");
    expect(rec).not.toHaveBeenCalled();
  });
  it("terminal event가 없으면 session 실패 기록 안 함", async () => {
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          yield { type: "text_delta" };
        })() as any,
    );
    const rec = vi.fn();
    expect((await attemptSingleModel("openai/gpt-high", 0, base() as any, rec)).status).toBe(
      "retry",
    );
    expect(rec).not.toHaveBeenCalled();
  });
  it("fallback 시 같은 lastDecision 객체 복사", async () => {
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          yield { type: "done", message: { usage: { cost: { total: 0 } } } };
        })() as any,
    );
    const dec = decision({ tier: "high" });
    const s: any = {
      failedByChain: new Map(),
      lastDecision: dec,
      accumulatedCost: 0,
      lastExtensionContext: { ui: { setHiddenThinkingLabel: vi.fn() } },
    };
    const r = await attemptSingleModel(
      "openai/gpt-high",
      1,
      base({ decision: dec, state: s }) as any,
      vi.fn(),
    );
    expect(r.status).toBe("success");
    expect(s.lastDecision).not.toBe(dec);
    expect(s.lastDecision.profile).toBe("balanced");
  });
  it("fallback 시 다른 profile의 lastDecision 유지", async () => {
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          yield { type: "done", message: { usage: { cost: { total: 0 } } } };
        })() as any,
    );
    const dec = decision({ tier: "high" });
    const s: any = {
      failedByChain: new Map(),
      lastDecision: { profile: "other" },
      accumulatedCost: 0,
    };
    const r = await attemptSingleModel(
      "openai/gpt-high",
      1,
      base({ decision: dec, state: s }) as any,
      vi.fn(),
    );
    expect(r.status).toBe("success");
    expect(s.lastDecision).toEqual({ profile: "other" });
  });
  it("streamDelegated throw 시 transient error 기록 없이 retry", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => {
      throw new Error("No delegated stream provider registered for openai");
    });
    const rec = vi.fn();
    const r = await attemptSingleModel("openai/gpt-high", 0, base() as any, rec);
    expect(r.status).toBe("retry");
    expect((r as { error: Error }).error.message).toContain("No delegated stream");
    expect(rec).not.toHaveBeenCalled();
  });
  it("streamDelegated 기록 불가 throw 시 기록 없이 retry", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => {
      throw new Error("boom");
    });
    const rec = vi.fn();
    const r = await attemptSingleModel("openai/gpt-high", 0, base() as any, rec);
    expect(r.status).toBe("retry");
    expect((r as { error: Error }).error.message).toBe("boom");
    expect(rec).not.toHaveBeenCalled();
  });
  it("toolcall event는 특별 처리 없이 버퍼링", async () => {
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          yield {
            type: "toolcall_end",
            toolCall: {
              name: "some_tool",
              arguments: { x: 1 },
            },
          };
          yield { type: "done", message: { usage: { cost: { total: 0 } } } };
        })() as any,
    );
    const push = vi.fn();
    const r = await attemptSingleModel(
      "openai/gpt-high",
      0,
      base({ stream: { push } } as any) as any,
      vi.fn(),
    );
    expect(r.status).toBe("success");
    expect(push).toHaveBeenCalledTimes(2);
  });
  it("opencode-go 위임 시 x-opencode-session을 주입한다", async () => {
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          yield { type: "done", message: { usage: { cost: { total: 0 } } } };
        })() as any,
    );
    const p = base({
      registry: {
        find: vi.fn(
          () =>
            ({
              provider: "opencode-go",
              id: "muse-spark-1.3-contributor",
              baseUrl: "https://opencode.ai/zen/go/v1",
              reasoning: false,
            }) as any,
        ),
        getApiKeyAndHeaders: vi.fn(async () => ({
          ok: true,
          apiKey: "k",
          headers: { Authorization: "Bearer k" },
        })),
      } as any,
      options: {
        sessionId: "sess-1",
        headers: { "x-caller": "yes" },
        transformHeaders: vi.fn(),
      } as any,
    });
    const r = await attemptSingleModel(
      "opencode-go/muse-spark-1.3-contributor",
      0,
      p as any,
      vi.fn(),
    );
    expect(r.status).toBe("success");
    const delegatedOpts = vi.mocked(streamDelegated).mock.calls[0][3] as Record<string, unknown>;
    expect(delegatedOpts["headers"]).toEqual({
      "x-opencode-session": "sess-1",
      "x-opencode-client": "pi",
      Authorization: "Bearer k",
      "x-caller": "yes",
    });
    expect(delegatedOpts["sessionId"]).toBe("sess-1");
    expect("transformHeaders" in (delegatedOpts as object)).toBe(false);
  });
  it("opencode 타깃이 아니면 세션 헤더를 주입하지 않는다", async () => {
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          yield { type: "done", message: { usage: { cost: { total: 0 } } } };
        })() as any,
    );
    const p = base({ options: { sessionId: "sess-1" } as any });
    const r = await attemptSingleModel("openai/gpt-high", 0, p as any, vi.fn());
    expect(r.status).toBe("success");
    const delegatedOpts = vi.mocked(streamDelegated).mock.calls[0][3] as Record<string, unknown>;
    expect(delegatedOpts["headers"]).not.toHaveProperty("x-opencode-session");
  });
});

describe("delegateToTierModels tier 모델 위임", () => {
  beforeEach(() => vi.clearAllMocks());
  it("모두 필터링되면 throw", async () => {
    const state: any = {
      failedByChain: new Map([["route:balanced:high", new Set(["openai/gpt-high"])]]),
      lastDecision: undefined,
      accumulatedCost: 0,
    };
    await expect(
      delegateToTierModels({
        registry: { find: vi.fn(), getApiKeyAndHeaders: vi.fn() } as any,
        profile: profile({ high: { models: ["openai/gpt-high"] } as any }),
        decision: decision({ tier: "high" }),
        routerModel: { contextWindow: 10000 } as any,
        context: { messages: [] } as any,
        state,
        withCommitMutex: async (fn: any) => fn(),
        stream: { push: vi.fn() } as any,
        recordDebugDecision: vi.fn(),
      }),
    ).rejects.toThrow("All models");
  });
  it("첫 번째 모델로 성공", async () => {
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          yield { type: "done", message: { usage: { cost: { total: 0 } } } };
        })() as any,
    );
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const res = await delegateToTierModels({
      registry: {
        find: () => ({ provider: "openai", id: "gpt-high", reasoning: false }) as any,
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }),
      } as any,
      profile: profile({ high: { models: ["openai/gpt-high"] } as any }),
      decision: decision({ tier: "high" }),
      routerModel: { contextWindow: 10000 } as any,
      context: { messages: [] } as any,
      state,
      withCommitMutex: async (fn: any) => fn(),
      stream: { push: vi.fn() } as any,
      recordDebugDecision: vi.fn(),
    });
    expect(res.success).toBe(true);
  });
  it("두 번째 모델로 fallback", async () => {
    let authCall = 0;
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          yield { type: "done", message: { usage: { cost: { total: 0.01 } } } };
        })() as any,
    );
    const state: any = {
      failedByChain: new Map(),
      lastDecision: { profile: "balanced" } as any,
      accumulatedCost: 0,
      lastExtensionContext: { ui: { setHiddenThinkingLabel: vi.fn() } },
    };
    const res = await delegateToTierModels({
      registry: {
        find: () => ({ provider: "openai", id: "gpt-high", reasoning: false }) as any,
        getApiKeyAndHeaders: async () => {
          authCall++;
          if (authCall === 1) return { ok: false, error: "bad" } as any;
          return { ok: true, apiKey: "k", headers: {} } as any;
        },
      } as any,
      profile: profile({ high: { models: ["openai/gpt-high", "openai/gpt-fallback"] } as any }),
      decision: decision({ tier: "high" }),
      routerModel: { contextWindow: 10000 } as any,
      context: { messages: [] } as any,
      state,
      withCommitMutex: async (fn: any) => fn(),
      stream: { push: vi.fn() } as any,
      recordDebugDecision: vi.fn(),
    });
    expect(res.success).toBe(true);
    expect(res.costDelta).toBe(0.01);
  });
  it("nonRetryable이면 중단", async () => {
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          yield { type: "text_delta" };
          yield { type: "error", error: { errorMessage: "fail" } };
        })() as any,
    );
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const res = await delegateToTierModels({
      registry: {
        find: () => ({ provider: "openai", id: "gpt-high", reasoning: false }) as any,
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }),
      } as any,
      profile: profile({ high: { models: ["openai/gpt-high"] } as any }),
      decision: decision({ tier: "high" }),
      routerModel: { contextWindow: 10000 } as any,
      context: { messages: [] } as any,
      state,
      withCommitMutex: async (fn: any) => fn(),
      stream: { push: vi.fn() } as any,
      recordDebugDecision: vi.fn(),
    });
    expect(res.success).toBe(false);
  });
  it("router를 건너뛰고 성공", async () => {
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          yield { type: "done", message: { usage: { cost: { total: 0 } } } };
        })() as any,
    );
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const res = await delegateToTierModels({
      registry: {
        find: () => ({ provider: "openai", id: "gpt-high", reasoning: false }) as any,
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }),
      } as any,
      profile: profile({ high: { models: ["router/auto", "openai/gpt-high"] } as any }),
      decision: decision({ tier: "high" }),
      routerModel: { contextWindow: 10000 } as any,
      context: { messages: [] } as any,
      state,
      withCommitMutex: async (fn: any) => fn(),
      stream: { push: vi.fn() } as any,
      recordDebugDecision: vi.fn(),
    });
    expect(res.success).toBe(true);
  });
  it("NON_RETRYABLE 접두사 없는 nonRetryable abort", async () => {
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const res = await delegateToTierModels({
      registry: {
        find: () => ({ provider: "openai", id: "gpt-high", reasoning: false }) as any,
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }),
      } as any,
      profile: profile({ high: { models: ["openai/gpt-high"] } as any }),
      decision: decision({ tier: "high" }),
      routerModel: { contextWindow: 10000 } as any,
      context: { messages: [] } as any,
      options: { signal: { aborted: true } as any },
      state,
      withCommitMutex: async (fn: any) => fn(),
      stream: { push: vi.fn() } as any,
      recordDebugDecision: vi.fn(),
    });
    expect(res.success).toBe(false);
    expect((res.lastError as Error).message).toBe("aborted");
  });
  it("retry 후 소진", async () => {
    vi.mocked(streamDelegated).mockImplementation(
      () =>
        (async function* () {
          yield { type: "error", error: { errorMessage: "fail" } };
        })() as any,
    );
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const res = await delegateToTierModels({
      registry: {
        find: () => ({ provider: "openai", id: "gpt-high", reasoning: false }) as any,
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }),
      } as any,
      profile: profile({ high: { models: ["openai/gpt-high"] } as any }),
      decision: decision({ tier: "high" }),
      routerModel: { contextWindow: 10000 } as any,
      context: { messages: [] } as any,
      state,
      withCommitMutex: async (fn: any) => fn(),
      stream: { push: vi.fn() } as any,
      recordDebugDecision: vi.fn(),
    });
    expect(res.success).toBe(false);
    expect((res.lastError as Error).message).toBe("fail");
  });
});

describe("toDelegateResult 위임 결과 변환", () => {
  const d = decision({ tier: "medium", profile: "balanced" });
  it("toDelegateResult 성공과 실패 매핑", () => {
    expect(toDelegateResult({ success: true, costDelta: 1 }, d).success).toBe(true);
    expect(
      toDelegateResult({ success: false, costDelta: 0, lastError: new Error("x") }, d).success,
    ).toBe(false);
  });
});

describe("delegate 논리적 ref 실시간 추적", () => {
  const liveProfiles = {
    balanced: {
      high: { ref: "base#high" },
      medium: { models: ["openai/gpt-medium"] },
    },
    base: {
      high: { models: ["openai/gpt-high"], resolvedContextWindow: 1000 },
    },
  } as any;
  it("getInitialModelsToTry가 추적된 모델을 반환함", () => {
    expect(
      getInitialModelsToTry(
        liveProfiles.balanced,
        decision({ profile: "balanced", tier: "high" }),
        liveProfiles,
      ),
    ).toEqual(["openai/gpt-high"]);
  });
  it("getInitialModelsToTry 추적 실패 시 기존 profile로 대체함", () => {
    const profiles = {
      balanced: { high: { ref: "missing#high" } },
    } as any;
    expect(
      getInitialModelsToTry(
        { high: { models: ["openai/fallback"] } } as any,
        decision({ profile: "balanced", tier: "high" }),
        profiles,
      ),
    ).toEqual(["openai/fallback"]);
  });
  it("resolveTargetLimit이 추적된 tier limit을 반환함", () => {
    const registry = { find: vi.fn().mockReturnValue({ contextWindow: 2000 }) } as any;
    expect(
      resolveTargetLimit(
        liveProfiles.balanced,
        decision({ profile: "balanced", tier: "high" }),
        "openai/gpt-high",
        registry,
        "openai",
        "gpt-high",
        liveProfiles,
      ),
    ).toBe(2000);
  });
  it("resolveTargetLimit이 목록에 없으면 registry 대체값을 반환함", () => {
    const registry = { find: vi.fn().mockReturnValue({ contextWindow: 3000 }) } as any;
    expect(
      resolveTargetLimit(
        liveProfiles.balanced,
        decision({ profile: "balanced", tier: "high" }),
        "openai/other",
        registry,
        "openai",
        "other",
        liveProfiles,
      ),
    ).toBe(3000);
  });
  it("resolveTargetLimit이 전부 해석 불가면 기본값을 반환함", () => {
    const profiles = { balanced: { high: { ref: "missing#high" } } } as any;
    const registry = { find: vi.fn().mockReturnValue(undefined) } as any;
    expect(
      resolveTargetLimit(
        profiles.balanced,
        decision({ profile: "balanced", tier: "high" }),
        "openai/other",
        registry,
        "openai",
        "other",
        profiles,
      ),
    ).toBe(128000);
  });
});
