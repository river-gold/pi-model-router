/* oxlint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";
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
} from "../../src/provider/delegate";
import type { RouterProfile, RoutingDecision } from "../../src/types";
import { streamDelegated } from "../../src/stream";

vi.mock("../../src/stream", async () => {
  const actual = (await vi.importActual("../../src/stream")) as any;
  return { ...actual, streamDelegated: vi.fn(), modelWithAuthBaseUrl: actual.modelWithAuthBaseUrl };
});

const profile = (over: Partial<RouterProfile> = {}): RouterProfile => ({
  high: { models: ["openai/gpt-high"], resolvedContextWindow: 1000 } as any,
  medium: { models: ["openai/gpt-medium"], resolvedContextWindow: 800 } as any,
  ...over,
});
const decision = (over: Partial<RoutingDecision> = {}): RoutingDecision => ({
  profile: "balanced",
  tier: "high",
  targetProvider: "openai",
  targetModelId: "gpt-high",
  targetLabel: "openai/gpt-high",
  reasoning: "r",
  thinking: "high",
  timestamp: Date.now(),
  ...over,
} as any);

describe("delegate pure helpers", () => {
  it("getInitialModelsToTry dedup and fallback", () => {
    expect(getInitialModelsToTry(profile({ high: { models: ["a/b", "a/b"] } as any }), decision({ tier: "high" }))).toEqual(["a/b"]);
    expect(getInitialModelsToTry(profile({ high: undefined }), decision({ tier: "high", targetProvider: "openai", targetModelId: "gpt" }))).toEqual(["openai/gpt#high"]);
  });
  it("filterByFailureMemory", () => {
    expect(filterByFailureMemory(["a/b"], undefined).filtered).toEqual(["a/b"]);
    expect(filterByFailureMemory(["a/b", "c/d"], new Set(["a/b"])).filtered).toEqual(["c/d"]);
    expect(filterByFailureMemory(["a/b"], new Set(["a/b"])).allFiltered).toBe(true);
  });
  it("createRecordFailure", () => {
    const state: any = { failedByChain: new Map() };
    const rec = createRecordFailure(state, "route:balanced:high");
    rec("a/b");
    expect(state.failedByChain.get("route:balanced:high")!.has("a/b")).toBe(true);
  });
  it("resolveTargetLimit", () => {
    const p = profile({ high: { models: ["openai/gpt-high"] } as any });
    const reg: any = { find: vi.fn() };
    expect(typeof resolveTargetLimit(p, decision({ tier: "high" }), "openai/gpt-high", reg, "openai", "gpt-high")).toBe("number");
    expect(typeof resolveTargetLimit(p, decision({ tier: "high" }), "other", { find: () => undefined } as any, "openai", "gpt-high")).toBe("number");
    expect(typeof resolveTargetLimit(p, decision({ tier: "high" }), "other", { find: () => ({ contextWindow: 500 } as any) } as any, "openai", "gpt-high")).toBe("number");
  });
  it("buildEffectiveContext", () => {
    const smallCtx: any = { messages: [{ role: "user", content: "hi", timestamp: 1 }] };
    const largeCtx: any = { messages: [{ role: "user", content: "a".repeat(5000), timestamp: 1 }, { role: "assistant", content: "b".repeat(5000), timestamp: 2 }, { role: "user", content: "c".repeat(5000), timestamp: 3 }] };
    expect(buildEffectiveContext(largeCtx, 50, { contextWindow: 100 } as any)).not.toBe(largeCtx);
    expect(buildEffectiveContext(smallCtx, 200, { contextWindow: 100 } as any)).toBe(smallCtx);
    expect(buildEffectiveContext(largeCtx, 200, { contextWindow: 10000 } as any)).not.toBe(largeCtx);
    expect(buildEffectiveContext(smallCtx, 10, {} as any)).toBe(smallCtx);
  });
  it("isContentEvent", () => {
    expect(isContentEvent("text_delta")).toBe(true);
    expect(isContentEvent("done")).toBe(false);
  });
  it("collectBufferedResult", () => {
    expect(collectBufferedResult([{ type: "done", message: { usage: { cost: { total: 0.5 } } } }]).gotDone).toBe(true);
    expect(collectBufferedResult([{ type: "error", error: { errorMessage: "oops" } }]).bufferedErrorMessage).toBe("oops");
    expect(collectBufferedResult([{ type: "text_delta" }]).contentReceived).toBe(true);
    expect(collectBufferedResult([]).gotDone).toBe(false);
  });
  it("resolveAuthError", () => {
    expect(resolveAuthError({ ok: false, error: "bad" } as any, "openai", "gpt").message).toContain("Auth failed");
    expect(resolveAuthError({ ok: true } as any, "openai", "gpt").message).toContain("No API key");
  });
  it("shouldSkipRouterModel and buildFallbackDecision", () => {
    expect(shouldSkipRouterModel("router")).toBe(true);
    const d = decision({ thinking: "high" });
    buildFallbackDecision(d, "anthropic/claude#low");
    expect(d.isFallback).toBe(true);
    expect(d.thinking).toBe("low");
    const d2 = decision({ thinking: "high" });
    buildFallbackDecision(d2, "openai/gpt");
    expect(d2.thinking).toBe("high");
  });
});

describe("attemptSingleModel", () => {
  beforeEach(() => vi.clearAllMocks());
  const baseParams = (over: any = {}) => ({
    registry: { find: vi.fn(() => ({ provider: "openai", id: "gpt-high", reasoning: false } as any)), getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "k", headers: {} })) } as any,
    profile: profile({ high: { models: ["openai/gpt-high"] } as any }),
    decision: decision({ tier: "high" }),
    routerModel: { contextWindow: 10000 } as any,
    context: { messages: [] } as any,
    state: { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined } as any,
    withCommitMutex: async (fn: any) => fn(),
    stream: { push: vi.fn() } as any,
    recordDebugDecision: vi.fn(),
    ...over,
  });

  it("skip router", async () => {
    const r = await attemptSingleModel("router/balanced", 0, baseParams() as any, vi.fn());
    expect(r.status).toBe("skip");
  });
  it("model not found", async () => {
    const p = baseParams({ registry: { find: () => undefined, getApiKeyAndHeaders: vi.fn() } as any });
    const r = await attemptSingleModel("openai/missing", 0, p as any, vi.fn());
    expect(r.status).toBe("retry");
  });
  it("auth failure", async () => {
    const p = baseParams({ registry: { find: () => ({ provider: "openai", id: "gpt-high" } as any), getApiKeyAndHeaders: async () => ({ ok: false, error: "bad" } as any) } as any });
    const r = await attemptSingleModel("openai/gpt-high", 0, p as any, vi.fn());
    expect(r.status).toBe("retry");
  });
  it("aborted signal", async () => {
    const p = baseParams({ options: { signal: { aborted: true } as any } as any });
    const r = await attemptSingleModel("openai/gpt-high", 0, p as any, vi.fn());
    expect(r.status).toBe("nonRetryable");
  });
  it("success with cost and fallback", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "done", message: { usage: { cost: { total: 0.02 } } } }; })() as any);
    const p = baseParams({ state: { failedByChain: new Map(), lastDecision: { profile: "balanced" } as any, accumulatedCost: 0, lastExtensionContext: { ui: { setHiddenThinkingLabel: vi.fn() } } } as any });
    const r = await attemptSingleModel("openai/gpt-high", 1, p as any, vi.fn());
    expect(r.status).toBe("success");
    expect(r.costDelta).toBe(0.02);
  });
  it("stale UI handled", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "done", message: { usage: { cost: { total: 0 } } } }; })() as any);
    const p = baseParams({ state: { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: { ui: { setHiddenThinkingLabel: () => { throw new Error("stale"); } } } } as any });
    const r = await attemptSingleModel("openai/gpt-high", 0, p as any, vi.fn());
    expect(r.status).toBe("success");
  });
  it("gotError with content -> nonRetryable", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "text_delta" }; yield { type: "error", error: { errorMessage: "fail" } }; })() as any);
    const r = await attemptSingleModel("openai/gpt-high", 0, baseParams() as any, vi.fn());
    expect(r.status).toBe("nonRetryable");
  });
  it("gotError without content -> retry", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "error", error: { errorMessage: "fail" } }; })() as any);
    const r = await attemptSingleModel("openai/gpt-high", 0, baseParams() as any, vi.fn());
    expect(r.status).toBe("retry");
  });
  it("no delegated stream", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => null as any);
    const r = await attemptSingleModel("openai/gpt-high", 0, baseParams() as any, vi.fn());
    expect(r.status).toBe("retry");
  });
  it("no terminal event", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "text_delta" }; })() as any);
    const r = await attemptSingleModel("openai/gpt-high", 0, baseParams() as any, vi.fn());
    expect(r.status).toBe("retry");
  });
});

describe("delegateToTierModels", () => {
  beforeEach(() => vi.clearAllMocks());
  it("all filtered throws", async () => {
    const state: any = { failedByChain: new Map([["route:balanced:high", new Set(["openai/gpt-high"])]]), lastDecision: undefined, accumulatedCost: 0 };
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
  it("success via first model", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "done", message: { usage: { cost: { total: 0 } } } }; })() as any);
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const res = await delegateToTierModels({
      registry: { find: () => ({ provider: "openai", id: "gpt-high", reasoning: false } as any), getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }) } as any,
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
  it("fallback on second model", async () => {
    let authCall = 0;
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "done", message: { usage: { cost: { total: 0.01 } } } }; })() as any);
    const state: any = { failedByChain: new Map(), lastDecision: { profile: "balanced" } as any, accumulatedCost: 0, lastExtensionContext: { ui: { setHiddenThinkingLabel: vi.fn() } } };
    const res = await delegateToTierModels({
      registry: {
        find: () => ({ provider: "openai", id: "gpt-high", reasoning: false } as any),
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
  it("nonRetryable aborts", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "text_delta" }; yield { type: "error", error: { errorMessage: "fail" } }; })() as any);
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const res = await delegateToTierModels({
      registry: { find: () => ({ provider: "openai", id: "gpt-high", reasoning: false } as any), getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }) } as any,
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
});

  it("attemptSingleModel stale UI and no reasoning", async () => {
    const { streamDelegated } = await import("../../src/stream");
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "done", message: { usage: { cost: { total: 0 } } } }; })() as any);
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: { ui: { setHiddenThinkingLabel: vi.fn(() => { throw new Error("stale"); }) } } };
    const reg: any = { find: () => ({ provider: "openai", id: "gpt-high", reasoning: false } as any), getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} } as any) };
    const { attemptSingleModel } = await import("../../src/provider/delegate");
    const prof = { high: { models: ["openai/gpt-high"] } } as any;
    const dec = { profile: "balanced", tier: "high", targetProvider: "openai", targetModelId: "gpt-high", thinking: undefined, timestamp: Date.now() } as any;
    const res = await attemptSingleModel("openai/gpt-high", 0, { registry: reg, profile: prof, decision: dec, routerModel: { contextWindow: 10000 } as any, context: { messages: [] } as any, state, withCommitMutex: async (fn: any) => fn(), stream: { push: vi.fn() } as any, recordDebugDecision: vi.fn() } as any, vi.fn());
    expect(res.status).toBe("success");
  });

  it("attemptSingleModel with reasoning true", async () => {
    const { streamDelegated } = await import("../../src/stream");
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "done", message: { usage: { cost: { total: 0 } } } }; })() as any);
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: { ui: { setHiddenThinkingLabel: vi.fn() } } };
    const reg: any = { find: () => ({ provider: "openai", id: "gpt-high", reasoning: true } as any), getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} } as any) };
    const { attemptSingleModel } = await import("../../src/provider/delegate");
    const prof = { high: { models: ["openai/gpt-high"] } } as any;
    const dec = { profile: "balanced", tier: "high", targetProvider: "openai", targetModelId: "gpt-high", thinking: "high", timestamp: Date.now() } as any;
    const res = await attemptSingleModel("openai/gpt-high", 0, { registry: reg, profile: prof, decision: dec, routerModel: { contextWindow: 10000 } as any, context: { messages: [] } as any, state, withCommitMutex: async (fn: any) => fn(), stream: { push: vi.fn() } as any, recordDebugDecision: vi.fn() } as any, vi.fn());
    expect(res.status).toBe("success");
  });

  it("collectBufferedResult with all event types", () => {
    const r = collectBufferedResult([
      { type: "done", message: { usage: { cost: { total: 1 } } } },
      { type: "error", error: { errorMessage: "e" } },
      { type: "text_delta" },
      { type: "thinking_delta" },
      { type: "toolcall_delta" },
      { type: "toolcall_end" },
    ]);
    expect(r.gotDone).toBe(true);
    expect(r.gotError).toBe(true);
    expect(r.contentReceived).toBe(true);
  });

  it("attemptSingleModel with undefined lastExtensionContext covers outer if false", async () => {
    const { streamDelegated } = await import("../../src/stream");
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "done", message: { usage: { cost: { total: 0 } } } }; })() as any);
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const reg: any = { find: () => ({ provider: "openai", id: "gpt-high", reasoning: false } as any), getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} } as any) };
    const { attemptSingleModel } = await import("../../src/provider/delegate");
    const prof = { high: { models: ["openai/gpt-high"] } } as any;
    const dec = { profile: "balanced", tier: "high", targetProvider: "openai", targetModelId: "gpt-high", thinking: "high", timestamp: Date.now() } as any;
    const res = await attemptSingleModel("openai/gpt-high", 0, { registry: reg, profile: prof, decision: dec, routerModel: { contextWindow: 10000 } as any, context: { messages: [] } as any, state, withCommitMutex: async (fn: any) => fn(), stream: { push: vi.fn() } as any, recordDebugDecision: vi.fn() } as any, vi.fn());
    expect(res.status).toBe("success");
  });

  it("stale outer try catch via getter throw", async () => {
    const { streamDelegated } = await import("../../src/stream");
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "done", message: { usage: { cost: { total: 0 } } } }; })() as any);
    const state: any = {
      failedByChain: new Map(),
      lastDecision: undefined,
      accumulatedCost: 0,
      get lastExtensionContext() { throw new Error("stale getter"); },
    };
    const reg: any = { find: () => ({ provider: "openai", id: "gpt-high", reasoning: false } as any), getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} } as any) };
    const { attemptSingleModel } = await import("../../src/provider/delegate");
    const prof = { high: { models: ["openai/gpt-high"] } } as any;
    const dec = { profile: "balanced", tier: "high", targetProvider: "openai", targetModelId: "gpt-high", thinking: "high", timestamp: Date.now() } as any;
    const res = await attemptSingleModel("openai/gpt-high", 0, { registry: reg, profile: prof, decision: dec, routerModel: { contextWindow: 10000 } as any, context: { messages: [] } as any, state, withCommitMutex: async (fn: any) => fn(), stream: { push: vi.fn() } as any, recordDebugDecision: vi.fn() } as any, vi.fn());
    expect(res.status).toBe("success");
  });

  it("covers aborted during stream", async () => {
    const signal: any = { aborted: false };
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const reg: any = {
      find: () => ({ provider: "openai", id: "gpt-high", reasoning: false } as any),
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} } as any),
    };
    const { streamDelegated } = await import("../../src/stream");
    vi.mocked(streamDelegated).mockImplementation(() => {
      return (async function* () {
        yield { type: "text_delta", delta: "hi" };
        signal.aborted = true;
        yield { type: "text_delta", delta: "hi2" };
      })() as any;
    });
    const { attemptSingleModel } = await import("../../src/provider/delegate");
    const prof = { high: { models: ["openai/gpt-high"] } } as any;
    const dec = { profile: "balanced", tier: "high", targetProvider: "openai", targetModelId: "gpt-high", thinking: "high", timestamp: Date.now() } as any;
    const res = await attemptSingleModel("openai/gpt-high", 0, { registry: reg, profile: prof, decision: dec, routerModel: { contextWindow: 10000 } as any, context: { messages: [] } as any, options: { signal } as any, state, withCommitMutex: async (fn: any) => fn(), stream: { push: vi.fn() } as any, recordDebugDecision: vi.fn() } as any, vi.fn());
    expect(res.status).toBe("nonRetryable");
    expect(res.error?.message).toBe("aborted");
  });

  it("covers fallback decision with cost and profile mismatch", async () => {
    const { streamDelegated } = await import("../../src/stream");
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "done", message: { usage: { cost: { total: 0.05 } } } }; })() as any);
    const state: any = { failedByChain: new Map(), lastDecision: { profile: "other", tier: "high" } as any, accumulatedCost: 0, lastExtensionContext: { ui: { setHiddenThinkingLabel: vi.fn() } } };
    const reg: any = { find: () => ({ provider: "openai", id: "gpt-high", reasoning: false } as any), getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} } as any) };
    const { attemptSingleModel } = await import("../../src/provider/delegate");
    const prof = { high: { models: ["openai/gpt-high"] } } as any;
    const dec = { profile: "balanced", tier: "high", targetProvider: "openai", targetModelId: "gpt-high", thinking: "high", timestamp: Date.now() } as any;
    const res = await attemptSingleModel("openai/gpt-high", 1, { registry: reg, profile: prof, decision: dec, routerModel: { contextWindow: 10000 } as any, context: { messages: [] } as any, state, withCommitMutex: async (fn: any) => fn(), stream: { push: vi.fn() } as any, recordDebugDecision: vi.fn() } as any, vi.fn());
    expect(res.status).toBe("success");
    // profile mismatch, so lastDecision should remain other, not updated to balanced
    expect(state.lastDecision.profile).toBe("other");
  });

  it("getInitialModelsToTry with empty tierModels uses fallback", async () => {
    const { getInitialModelsToTry } = await import("../../src/provider/delegate");
    const p = { high: { models: [] } } as any;
    const d = { tier: "high", targetProvider: "openai", targetModelId: "gpt", thinking: "high" } as any;
    expect(getInitialModelsToTry(p, d)).toEqual(["openai/gpt#high"]);
  });

  it("filterByFailureMemory with undefined and empty", async () => {
    const { filterByFailureMemory } = await import("../../src/provider/delegate");
    expect(filterByFailureMemory(["a/b"], undefined).allFiltered).toBe(false);
    expect(filterByFailureMemory(["a/b"], new Set()).allFiltered).toBe(false);
  });

  it("delegate allFiltered with empty initial", async () => {
    const { delegateToTierModels } = await import("../../src/provider/delegate");
    const state: any = { failedByChain: new Map([["route:balanced:high", new Set()]]), lastDecision: undefined, accumulatedCost: 0 };
    const prof = { high: { models: ["openai/gpt-high"] } } as any;
    const dec = { profile: "balanced", tier: "high", targetProvider: "openai", targetModelId: "gpt-high", thinking: "high", timestamp: Date.now() } as any;
    const reg: any = { find: () => ({ provider: "openai", id: "gpt-high" } as any), getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} } as any) };
    const { streamDelegated } = await import("../../src/stream");
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "done", message: { usage: { cost: { total: 0 } } } }; })() as any);
    const res = await delegateToTierModels({
      registry: reg,
      profile: prof,
      decision: dec,
      routerModel: { contextWindow: 10000 } as any,
      context: { messages: [] } as any,
      state,
      withCommitMutex: async (fn: any) => fn(),
      stream: { push: vi.fn() } as any,
      recordDebugDecision: vi.fn(),
    });
    expect(res.success).toBe(true);
  });

  it("resolveTargetLimit with undefined tier hits continue", async () => {
    const { resolveTargetLimit } = await import("../../src/provider/delegate");
    const p = {} as any;
    const reg: any = { find: () => undefined };
    const d = { tier: "high", targetProvider: "openai", targetModelId: "gpt", thinking: "high" } as any;
    const v = resolveTargetLimit(p, d, "unknown/model", reg, "unknown", "model");
    expect(typeof v).toBe("number");
  });

  it("attemptSingleModel fallback with same object updates", async () => {
    const { streamDelegated } = await import("../../src/stream");
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "done", message: { usage: { cost: { total: 0.01 } } } }; })() as any);
    const dec: any = { profile: "balanced", tier: "high", targetProvider: "openai", targetModelId: "gpt-high", thinking: "high", timestamp: Date.now() };
    const state: any = { failedByChain: new Map(), lastDecision: dec, accumulatedCost: 0, lastExtensionContext: { ui: { setHiddenThinkingLabel: vi.fn() } } };
    const reg: any = { find: () => ({ provider: "openai", id: "gpt-high", reasoning: false } as any), getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} } as any) };
    const { attemptSingleModel } = await import("../../src/provider/delegate");
    const prof = { high: { models: ["openai/gpt-high"] } } as any;
    const res = await attemptSingleModel("openai/gpt-high", 1, { registry: reg, profile: prof, decision: dec, routerModel: { contextWindow: 10000 } as any, context: { messages: [] } as any, state, withCommitMutex: async (fn: any) => fn(), stream: { push: vi.fn() } as any, recordDebugDecision: vi.fn() } as any, vi.fn());
    expect(res.status).toBe("success");
    expect(state.lastDecision.profile).toBe("balanced");
  });

  it("covers remaining branches for 100%", async () => {
    // getInitialModelsToTry with undefined tierModels
    const { getInitialModelsToTry } = await import("../../src/provider/delegate");
    const pEmpty = { high: undefined } as any;
    const dEmpty = { tier: "high", targetProvider: "openai", targetModelId: "gpt", thinking: undefined } as any;
    expect(getInitialModelsToTry(pEmpty, dEmpty)).toEqual(["openai/gpt"]);

    // filterByFailureMemory with undefined
    const { filterByFailureMemory } = await import("../../src/provider/delegate");
    expect(filterByFailureMemory(["a/b"], undefined).filtered).toEqual(["a/b"]);

    // resolveTargetLimit with found undefined
    const { resolveTargetLimit } = await import("../../src/provider/delegate");
    const p2 = { high: { models: ["other"] } } as any;
    const reg2: any = { find: () => undefined };
    const d2 = { tier: "high", targetProvider: "openai", targetModelId: "gpt" } as any;
    expect(typeof resolveTargetLimit(p2, d2, "unknown", reg2, "openai", "gpt")).toBe("number");

    // buildEffectiveContext with no truncate
    const { buildEffectiveContext } = await import("../../src/provider/delegate");
    const ctx: any = { messages: [{ role: "user", content: "hi", timestamp: 1 }] };
    const largeCtx: any = { messages: [{ role: "user", content: "a".repeat(5000), timestamp: 1 }, { role: "assistant", content: "b".repeat(5000), timestamp: 2 }, { role: "user", content: "c".repeat(5000), timestamp: 3 }] };
    expect(buildEffectiveContext(ctx, 1000, { contextWindow: 100 } as any)).toBe(ctx);
    expect(buildEffectiveContext(largeCtx, 200, { contextWindow: 10000 } as any)).not.toBe(largeCtx);

    // isContentEvent false
    const { isContentEvent } = await import("../../src/provider/delegate");
    expect(isContentEvent("done")).toBe(false);

    // collectBufferedResult with cost 0
    const { collectBufferedResult } = await import("../../src/provider/delegate");
    const r = collectBufferedResult([{ type: "done", message: { usage: { cost: { total: 0 } } } }]);
    expect(r.pendingCostDelta).toBe(0);

    // resolveAuthError both branches
    const { resolveAuthError } = await import("../../src/provider/delegate");
    expect(resolveAuthError({ ok: false, error: "e" } as any, "openai", "gpt").message).toContain("Auth failed");
    expect(resolveAuthError({ ok: true } as any, "openai", "gpt").message).toContain("No API key");

    // shouldSkip
    const { shouldSkipRouterModel } = await import("../../src/provider/delegate");
    expect(shouldSkipRouterModel("router")).toBe(true);
    expect(shouldSkipRouterModel("openai")).toBe(false);

    // buildFallbackDecision without thinking
    const { buildFallbackDecision } = await import("../../src/provider/delegate");
    const dec: any = { profile: "balanced", tier: "high", targetProvider: "openai", targetModelId: "old", thinking: "high", isFallback: false };
    buildFallbackDecision(dec, "openai/new");
    expect(dec.targetModelId).toBe("new");
    expect(dec.thinking).toBe("high");
  });
