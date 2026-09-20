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
import type { DelegateParams } from "../../src/provider/delegate";
import type { Router, RoutingDecision } from "../../src/types";
import { clearRateLimitCooldowns, liveRateLimitedRefs } from "../../src/failureMemory";
import { fakeSignal, makeFakeModel, makeFakeRegistry, makeStreamSpy } from "../helpers";

const { mockStreamDelegated } = vi.hoisted(() => ({ mockStreamDelegated: vi.fn() }));

import type * as StreamModule from "../../src/stream";

vi.mock("../../src/stream", async () => {
  const actual = await vi.importActual<typeof StreamModule>("../../src/stream");
  return { ...actual, streamDelegated: mockStreamDelegated };
});

const router = (over: Partial<Router> = {}): Router =>
  Object.assign(
    {
      high: { models: ["openai/gpt-high"], resolvedContextWindow: 1000 },
      medium: { models: ["openai/gpt-medium"], resolvedContextWindow: 800 },
    },
    over,
  );
const decision = (over: Partial<RoutingDecision> = {}): RoutingDecision =>
  Object.assign(
    {
      router: "balanced",
      tier: "high",
      targetProvider: "openai",
      targetModelId: "gpt-high",
      targetLabel: "openai/gpt-high",
      reasoning: "r",
      effort: "high",
      timestamp: Date.now(),
    },
    over,
  );

const base = (over: Partial<DelegateParams> = {}): DelegateParams =>
  Object.assign(
    {
      registry: makeFakeRegistry({
        find: () => makeFakeModel({ provider: "openai", id: "gpt-high", reasoning: false }),
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }),
      }),
      router: router({ high: { models: ["openai/gpt-high"] } }),
      decision: decision({ tier: "high" }),
      routerModel: makeFakeModel({ contextWindow: 10000 }),
      context: { messages: [] },
      state: {
        failedByChain: new Map(),
        lastDecision: undefined,
        accumulatedCost: 0,
        lastExtensionContext: undefined,
      },
      withCommitMutex: async <T>(fn: () => T | Promise<T>): Promise<T> => fn(),
      stream: makeStreamSpy().stream,
      recordDebugDecision: vi.fn(),
    },
    over,
  );

describe("delegate 순수 헬퍼 함수들", () => {
  it("getInitialModelsToTry 중복 제거", () => {
    expect(
      getInitialModelsToTry(
        router({ high: { models: ["a/b", "a/b"] } }),
        decision({ tier: "high" }),
      ),
    ).toEqual(["a/b"]);
  });
  it("getInitialModelsToTry tier가 undefined인 경우", () => {
    expect(
      getInitialModelsToTry(
        router({ high: undefined }),
        decision({ tier: "high", targetProvider: "openai", targetModelId: "gpt" }),
      ),
    ).toEqual(["openai/gpt#high"]);
  });
  it("getInitialModelsToTry tier가 비어 있는 경우", () => {
    expect(
      getInitialModelsToTry(
        router({ high: { models: [] } }),
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
    const p = router({ high: { models: ["openai/gpt-high"] } });
    expect(
      typeof resolveTargetLimit(
        p,
        decision({ tier: "high" }),
        "openai/gpt-high",
        makeFakeRegistry({ find: vi.fn() }),
        "openai",
        "gpt-high",
      ),
    ).toBe("number");
    expect(
      typeof resolveTargetLimit(
        { high: undefined },
        decision({ tier: "high" }),
        "x",
        makeFakeRegistry({ find: () => makeFakeModel({ contextWindow: 500 }) }),
        "x",
        "y",
      ),
    ).toBe("number");
    expect(
      typeof resolveTargetLimit(
        { high: undefined },
        decision({ tier: "high" }),
        "x",
        makeFakeRegistry({ find: () => undefined }),
        "x",
        "y",
      ),
    ).toBe("number");
    expect(
      typeof resolveTargetLimit(
        router({
          high: { models: ["openai/gpt-high"] },
          medium: { models: ["openai/gpt-medium"] },
        }),
        decision({ tier: "high" }),
        "openai/gpt-medium",
        makeFakeRegistry({ find: vi.fn() }),
        "openai",
        "gpt-medium",
      ),
    ).toBe("number");
    expect(
      typeof resolveTargetLimit(
        { high: { models: undefined } },
        decision({ tier: "high" }),
        "x",
        makeFakeRegistry({ find: () => undefined }),
        "x",
        "y",
      ),
    ).toBe("number");
    expect(
      typeof resolveTargetLimit(
        { high: undefined },
        decision({ tier: "high" }),
        "x",
        makeFakeRegistry({ find: () => makeFakeModel() }),
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
    expect(buildEffectiveContext(large, 50, makeFakeModel({ contextWindow: 100 }))).not.toBe(large);
    expect(buildEffectiveContext(small, 200, makeFakeModel({ contextWindow: 100 }))).toBe(small);
    expect(buildEffectiveContext(small, 10, makeFakeModel({ contextWindow: undefined }))).toBe(
      small,
    );
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
    expect(resolveAuthError({ ok: false, error: "bad" }, "openai", "gpt").message).toContain(
      "Auth failed",
    );
    expect(resolveAuthError({ ok: true }, "openai", "gpt").message).toContain("No API key");
    expect(shouldSkipRouterModel("router")).toBe(true);
    expect(shouldSkipRouterModel("openai")).toBe(false);
  });
  it("buildFallbackDecision 폴백 decision 구성", () => {
    const d = decision({ effort: "high" });
    buildFallbackDecision(d, "anthropic/claude#low");
    expect(d.isFallback && d.targetProvider === "anthropic" && d.effort === "low").toBe(true);
    const d2 = decision({ effort: "high" });
    buildFallbackDecision(d2, "openai/gpt");
    expect(d2.effort).toBe("high");
  });
});

describe("attemptSingleModel 단일 모델 시도", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => clearRateLimitCooldowns());
  it("router 모델은 skip", async () =>
    expect((await attemptSingleModel("router/balanced", 0, base(), vi.fn())).status).toBe("skip"));
  it("model을 찾지 못하면 retry", async () =>
    expect(
      (
        await attemptSingleModel(
          "openai/missing",
          0,
          base({
            registry: makeFakeRegistry({ find: () => undefined, getApiKeyAndHeaders: vi.fn() }),
          }),
          vi.fn(),
        )
      ).status,
    ).toBe("retry"));
  it("auth 실패 시 retry", async () => {
    const p = base({
      registry: makeFakeRegistry({
        find: () => makeFakeModel({ provider: "openai", id: "gpt-high" }),
        getApiKeyAndHeaders: async () => ({ ok: false, error: "bad" }),
      }),
    });
    expect((await attemptSingleModel("openai/gpt-high", 0, p, vi.fn())).status).toBe("retry");
  });
  it("성공 시 stale UI 처리", async () => {
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0.02 } } } };
      })(),
    );
    const s: any = {
      failedByChain: new Map(),
      lastDecision: { router: "balanced" },
      accumulatedCost: 0,
      lastExtensionContext: { ui: { setHiddenThinkingLabel: vi.fn() } },
    };
    const r = await attemptSingleModel("openai/gpt-high", 1, base({ state: s }), vi.fn());
    expect(r.status).toBe("success");
    expect(r.costDelta).toBe(0.02);
  });
  it("stale UI throw 시에도 성공", async () => {
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })(),
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
      (await attemptSingleModel("openai/gpt-high", 0, base({ state: s }), vi.fn())).status,
    ).toBe("success");
  });
  it("reasoning이 true인 경우", async () => {
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })(),
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
            decision: decision({ tier: "high", effort: "high" }),
            registry: makeFakeRegistry({
              find: () => makeFakeModel({ provider: "openai", id: "gpt-high", reasoning: true }),
              getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }),
            }),
          }),
          vi.fn(),
        )
      ).status,
    ).toBe("success");
  });
  it("stream 전에 aborted면 nonRetryable", async () =>
    expect(
      (
        await attemptSingleModel(
          "openai/gpt-high",
          0,
          base({ options: { signal: fakeSignal(true) } }),
          vi.fn(),
        )
      ).status,
    ).toBe("nonRetryable"));
  it("stream 도중 aborted면 nonRetryable", async () => {
    const signal: any = { aborted: false };
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield { type: "text_delta" };
        signal.aborted = true;
        yield { type: "text_delta" };
      })(),
    );
    expect(
      (await attemptSingleModel("openai/gpt-high", 0, base({ options: { signal } }), vi.fn()))
        .status,
    ).toBe("nonRetryable");
  });
  it("stream의 non-abort throw는 전파", async () => {
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield { type: "text_delta" };
        throw new Error("boom");
      })(),
    );
    await expect(attemptSingleModel("openai/gpt-high", 0, base(), vi.fn())).rejects.toThrow("boom");
  });
  it("content 전송 후 gotError면 nonRetryable", async () => {
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield { type: "text_delta" };
        yield { type: "error", error: { errorMessage: "fail" } };
      })(),
    );
    expect((await attemptSingleModel("openai/gpt-high", 0, base(), vi.fn())).status).toBe(
      "nonRetryable",
    );
  });
  it("content 없이 gotError면 retry", async () => {
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield { type: "error", error: { errorMessage: "fail" } };
      })(),
    );
    expect((await attemptSingleModel("openai/gpt-high", 0, base(), vi.fn())).status).toBe("retry");
  });
  it("delegated stream이 없으면 retry", async () => {
    mockStreamDelegated.mockImplementation(() => null);
    expect((await attemptSingleModel("openai/gpt-high", 0, base(), vi.fn())).status).toBe("retry");
  });
  it("terminal event가 없으면 retry", async () => {
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield { type: "text_delta" };
      })(),
    );
    expect((await attemptSingleModel("openai/gpt-high", 0, base(), vi.fn())).status).toBe("retry");
  });
  it("model을 찾지 못하면 session 실패 기록", async () => {
    const rec = vi.fn();
    expect(
      (
        await attemptSingleModel(
          "openai/missing",
          0,
          base({
            registry: makeFakeRegistry({ find: () => undefined, getApiKeyAndHeaders: vi.fn() }),
          }),
          rec,
        )
      ).status,
    ).toBe("retry");
    expect(rec).toHaveBeenCalled();
  });
  it("apiKey 없이 auth ok면 retry", async () => {
    const rec = vi.fn();
    const p = base({
      registry: makeFakeRegistry({
        find: () => makeFakeModel({ provider: "openai", id: "gpt-high" }),
        getApiKeyAndHeaders: async () => ({ ok: true }),
      }),
    });
    expect((await attemptSingleModel("openai/gpt-high", 0, p, rec)).status).toBe("retry");
    expect(rec).toHaveBeenCalled();
  });
  it("auth 실패 시 session 실패 기록", async () => {
    const rec = vi.fn();
    const p = base({
      registry: makeFakeRegistry({
        find: () => makeFakeModel({ provider: "openai", id: "gpt-high" }),
        getApiKeyAndHeaders: async () => ({ ok: false, error: "bad" }),
      }),
    });
    expect((await attemptSingleModel("openai/gpt-high", 0, p, rec)).status).toBe("retry");
    expect(rec).toHaveBeenCalled();
  });
  it("delegated stream이 없으면 session 실패 기록 안 함", async () => {
    mockStreamDelegated.mockImplementation(() => null);
    const rec = vi.fn();
    expect((await attemptSingleModel("openai/gpt-high", 0, base(), rec)).status).toBe("retry");
    expect(rec).not.toHaveBeenCalled();
  });
  it("message 없이 content 전송 후 gotError 처리", async () => {
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield { type: "text_delta" };
        yield { type: "error" };
      })(),
    );
    const r = await attemptSingleModel("openai/gpt-high", 0, base(), vi.fn());
    if (r.status !== "nonRetryable") expect.unreachable();
    expect(r.error.message).toContain("Model failed after sending content.");
  });
  it("gotError 429는 해당 model만 cooldown", async () => {
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield {
          type: "error",
          error: {
            errorMessage:
              '429: {"message":"limit resets at 2099-01-01T00:00:00.000Z.","type":"rate_limit_error","code":"RATE_LIMITED"}',
          },
        };
      })(),
    );
    const rec = vi.fn();
    const r = await attemptSingleModel("commandcode/m", 0, base(), rec);
    expect(r.status).toBe("retry");
    expect(rec).not.toHaveBeenCalled();
    expect(liveRateLimitedRefs("route:balanced:high").has("commandcode/m")).toBe(true);
  });
  it("message 없이 content 없는 gotError는 기록 안 함", async () => {
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield { type: "error" };
      })(),
    );
    const rec = vi.fn();
    const r = await attemptSingleModel("openai/gpt-high", 0, base(), vi.fn());
    if (r.status !== "retry") expect.unreachable();
    expect(String(r.error)).toContain("Model failed before sending content.");
    expect(rec).not.toHaveBeenCalled();
  });
  it("terminal event가 없으면 session 실패 기록 안 함", async () => {
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield { type: "text_delta" };
      })(),
    );
    const rec = vi.fn();
    expect((await attemptSingleModel("openai/gpt-high", 0, base(), rec)).status).toBe("retry");
    expect(rec).not.toHaveBeenCalled();
  });
  it("fallback 시 같은 lastDecision 객체 복사", async () => {
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })(),
    );
    const dec = decision({ tier: "high" });
    const s: any = {
      failedByChain: new Map(),
      lastDecision: dec,
      accumulatedCost: 0,
    };
    const r = await attemptSingleModel(
      "openai/gpt-high",
      1,
      base({ decision: dec, state: s }),
      vi.fn(),
    );
    expect(r.status).toBe("success");
    expect(s.lastDecision).not.toBe(dec);
    expect(s.lastDecision.router).toBe("balanced");
  });
  it("fallback 시 다른 router의 lastDecision 유지", async () => {
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })(),
    );
    const dec = decision({ tier: "high" });
    const s: any = {
      failedByChain: new Map(),
      lastDecision: { router: "other" },
      accumulatedCost: 0,
    };
    const r = await attemptSingleModel(
      "openai/gpt-high",
      1,
      base({ decision: dec, state: s }),
      vi.fn(),
    );
    expect(r.status).toBe("success");
    expect(s.lastDecision).toEqual({ router: "other" });
  });
  it("streamDelegated throw 시 transient error 기록 없이 retry", async () => {
    mockStreamDelegated.mockImplementation(() => {
      throw new Error("No delegated stream provider registered for openai");
    });
    const rec = vi.fn();
    const r = await attemptSingleModel("openai/gpt-high", 0, base(), rec);
    if (r.status !== "retry" || !(r.error instanceof Error)) expect.unreachable();
    expect(r.error.message).toContain("No delegated stream");
    expect(rec).not.toHaveBeenCalled();
  });
  it("streamDelegated 기록 불가 throw 시 기록 없이 retry", async () => {
    mockStreamDelegated.mockImplementation(() => {
      throw new Error("boom");
    });
    const rec = vi.fn();
    const r = await attemptSingleModel("openai/gpt-high", 0, base(), rec);
    if (r.status !== "retry" || !(r.error instanceof Error)) expect.unreachable();
    expect(r.error.message).toBe("boom");
    expect(rec).not.toHaveBeenCalled();
  });
  it("toolcall event는 특별 처리 없이 버퍼링", async () => {
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield {
          type: "toolcall_end",
          toolCall: {
            name: "some_tool",
            arguments: { x: 1 },
          },
        };
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })(),
    );
    const { stream, push } = makeStreamSpy();
    const r = await attemptSingleModel("openai/gpt-high", 0, base({ stream }), vi.fn());
    expect(r.status).toBe("success");
    expect(push).toHaveBeenCalledTimes(2);
  });
  it("opencode-go 위임 시 x-opencode-session을 주입한다", async () => {
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })(),
    );
    const p = base({
      registry: makeFakeRegistry({
        find: () =>
          makeFakeModel({
            provider: "opencode-go",
            id: "muse-spark-1.3-contributor",
            baseUrl: "https://opencode.ai/zen/go/v1",
            reasoning: false,
          }),
        getApiKeyAndHeaders: vi.fn(async () => ({
          ok: true,
          apiKey: "k",
          headers: { Authorization: "Bearer k" },
        })),
      }),
      options: {
        sessionId: "sess-1",
        headers: { "x-caller": "yes" },
        transformHeaders: vi.fn(),
      },
    });
    const r = await attemptSingleModel("opencode-go/muse-spark-1.3-contributor", 0, p, vi.fn());
    expect(r.status).toBe("success");
    const delegatedOpts = mockStreamDelegated.mock.calls[0][3];
    expect(delegatedOpts["headers"]).toEqual({
      "x-opencode-session": "sess-1",
      "x-opencode-client": "pi",
      Authorization: "Bearer k",
      "x-caller": "yes",
    });
    expect(delegatedOpts["sessionId"]).toBe("sess-1");
    expect("transformHeaders" in delegatedOpts).toBe(false);
  });
  it("opencode 타깃이 아니면 세션 헤더를 주입하지 않는다", async () => {
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })(),
    );
    const p = base({ options: { sessionId: "sess-1" } });
    const r = await attemptSingleModel("openai/gpt-high", 0, p, vi.fn());
    expect(r.status).toBe("success");
    const delegatedOpts = mockStreamDelegated.mock.calls[0][3];
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
    await expect(delegateToTierModels(base({ state }))).rejects.toThrow("All models");
  });
  it("첫 번째 모델로 성공", async () => {
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })(),
    );
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const res = await delegateToTierModels(base({ state }));
    expect(res.success).toBe(true);
  });
  it("두 번째 모델로 fallback", async () => {
    let authCall = 0;
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0.01 } } } };
      })(),
    );
    const state: any = {
      failedByChain: new Map(),
      lastDecision: { router: "balanced" },
      accumulatedCost: 0,
      lastExtensionContext: { ui: { setHiddenThinkingLabel: vi.fn() } },
    };
    const res = await delegateToTierModels(
      base({
        state,
        router: router({ high: { models: ["openai/gpt-high", "openai/gpt-fallback"] } }),
        registry: makeFakeRegistry({
          find: () => makeFakeModel({ provider: "openai", id: "gpt-high", reasoning: false }),
          getApiKeyAndHeaders: async () => {
            authCall++;
            if (authCall === 1) return { ok: false, error: "bad" };
            return { ok: true, apiKey: "k", headers: {} };
          },
        }),
      }),
    );
    expect(res.success).toBe(true);
    expect(res.costDelta).toBe(0.01);
  });
  it("nonRetryable이면 중단", async () => {
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield { type: "text_delta" };
        yield { type: "error", error: { errorMessage: "fail" } };
      })(),
    );
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const res = await delegateToTierModels(base({ state }));
    expect(res.success).toBe(false);
  });
  it("router를 건너뛰고 성공", async () => {
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })(),
    );
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const res = await delegateToTierModels(
      base({
        state,
        router: router({ high: { models: ["router/auto", "openai/gpt-high"] } }),
      }),
    );
    expect(res.success).toBe(true);
  });
  it("NON_RETRYABLE 접두사 없는 nonRetryable abort", async () => {
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const res = await delegateToTierModels(base({ state, options: { signal: fakeSignal(true) } }));
    expect(res.success).toBe(false);
    if (!(res.lastError instanceof Error)) expect.unreachable();
    expect(res.lastError.message).toBe("aborted");
  });
  it("retry 후 소진", async () => {
    mockStreamDelegated.mockImplementation(() =>
      (async function* () {
        yield { type: "error", error: { errorMessage: "fail" } };
      })(),
    );
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const res = await delegateToTierModels(base({ state }));
    expect(res.success).toBe(false);
    if (!(res.lastError instanceof Error)) expect.unreachable();
    expect(res.lastError.message).toBe("fail");
  });
});

describe("toDelegateResult 위임 결과 변환", () => {
  const d = decision({ tier: "medium", router: "balanced" });
  it("toDelegateResult 성공과 실패 매핑", () => {
    expect(toDelegateResult({ success: true, costDelta: 1 }, d).success).toBe(true);
    expect(
      toDelegateResult({ success: false, costDelta: 0, lastError: new Error("x") }, d).success,
    ).toBe(false);
  });
});

describe("delegate 논리적 ref 실시간 추적", () => {
  const liveRouters: Record<string, Router> = {
    balanced: {
      high: { models: ["@base#high"] },
      medium: { models: ["openai/gpt-medium"] },
    },
    base: {
      high: { models: ["openai/gpt-high"], resolvedContextWindow: 1000 },
    },
  };
  it("getInitialModelsToTry가 추적된 모델을 반환함", () => {
    expect(
      getInitialModelsToTry(
        liveRouters.balanced,
        decision({ router: "balanced", tier: "high" }),
        liveRouters,
      ),
    ).toEqual(["openai/gpt-high"]);
  });
  it("getInitialModelsToTry 추적 실패 시 기존 router로 대체함", () => {
    const routers: Record<string, Router> = {
      balanced: { high: { ref: "missing#high" } },
    };
    expect(
      getInitialModelsToTry(
        { high: { models: ["openai/fallback"] } },
        decision({ router: "balanced", tier: "high" }),
        routers,
      ),
    ).toEqual(["openai/fallback"]);
  });
  it("getInitialModelsToTry 추적 실패 + 로컬 모델이 없으면 원본 tier 목록을 그대로 반환함", () => {
    const routers: Record<string, Router> = { balanced: {} };
    expect(
      getInitialModelsToTry(
        { high: { models: ["@missing#high"] } },
        decision({ router: "balanced", tier: "high" }),
        routers,
      ),
    ).toEqual(["@missing#high"]);
  });
  it("resolveTargetLimit이 추적된 tier limit을 반환함", () => {
    const registry = makeFakeRegistry({
      find: vi.fn().mockReturnValue(makeFakeModel({ contextWindow: 2000 })),
    });
    expect(
      resolveTargetLimit(
        liveRouters.balanced,
        decision({ router: "balanced", tier: "high" }),
        "openai/gpt-high",
        registry,
        "openai",
        "gpt-high",
        liveRouters,
      ),
    ).toBe(2000);
  });
  it("resolveTargetLimit이 목록에 없으면 registry 대체값을 반환함", () => {
    const registry = makeFakeRegistry({
      find: vi.fn().mockReturnValue(makeFakeModel({ contextWindow: 3000 })),
    });
    expect(
      resolveTargetLimit(
        liveRouters.balanced,
        decision({ router: "balanced", tier: "high" }),
        "openai/other",
        registry,
        "openai",
        "other",
        liveRouters,
      ),
    ).toBe(3000);
  });
  it("resolveTargetLimit이 전부 해석 불가면 기본값을 반환함", () => {
    const routers: Record<string, Router> = { balanced: { high: { ref: "missing#high" } } };
    const registry = makeFakeRegistry({ find: vi.fn().mockReturnValue(undefined) });
    expect(
      resolveTargetLimit(
        routers.balanced,
        decision({ router: "balanced", tier: "high" }),
        "openai/other",
        registry,
        "openai",
        "other",
        routers,
      ),
    ).toBe(128000);
  });
});
