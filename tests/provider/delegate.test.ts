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
import { isRecordablePreStreamError } from "../../src/failureMemory";

vi.mock("../../src/stream", async () => {
  const actual = (await vi.importActual("../../src/stream")) as any;
  return { ...actual, streamDelegated: vi.fn(), modelWithAuthBaseUrl: actual.modelWithAuthBaseUrl };
});
vi.mock("../../src/failureMemory", async () => {
  const actual = (await vi.importActual("../../src/failureMemory")) as any;
  return { ...actual, isRecordablePreStreamError: vi.fn(actual.isRecordablePreStreamError) };
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
  it("getInitialModelsToTry dedup", () => {
    expect(getInitialModelsToTry(profile({ high: { models: ["a/b", "a/b"] } as any }), decision({ tier: "high" }))).toEqual(["a/b"]);
  });
  it("getInitialModelsToTry undefined tier", () => {
    expect(getInitialModelsToTry(profile({ high: undefined }), decision({ tier: "high", targetProvider: "openai", targetModelId: "gpt" }))).toEqual(["openai/gpt#high"]);
  });
  it("getInitialModelsToTry empty tier", () => {
    expect(getInitialModelsToTry(profile({ high: { models: [] } as any }), decision({ tier: "high", targetProvider: "openai", targetModelId: "gpt" }))).toEqual(["openai/gpt#high"]);
  });
  it("filterByFailureMemory", () => {
    expect(filterByFailureMemory(["a/b"], undefined).filtered).toEqual(["a/b"]);
    expect(filterByFailureMemory(["a/b"], new Set()).filtered).toEqual(["a/b"]);
    expect(filterByFailureMemory(["a/b", "c/d"], new Set(["a/b"]))).toEqual({ filtered: ["c/d"], skipped: ["a/b"], allFiltered: false });
    expect(filterByFailureMemory(["a/b"], new Set(["a/b"])).allFiltered).toBe(true);
    expect(filterByFailureMemory([], new Set(["a/b"])).allFiltered).toBe(false);
  });
  it("createRecordFailure", () => {
    const state: any = { failedByChain: new Map() };
    const rec = createRecordFailure(state, "route:balanced:high");
    rec("a/b");
    expect(state.failedByChain.get("route:balanced:high")!.has("a/b")).toBe(true);
    rec("a/b");
    expect(state.failedByChain.get("route:balanced:high")!.size).toBe(1);
  });
  it("resolveTargetLimit", () => {
    const p = profile({ high: { models: ["openai/gpt-high"] } as any });
    expect(typeof resolveTargetLimit(p, decision({ tier: "high" }), "openai/gpt-high", { find: vi.fn() } as any, "openai", "gpt-high")).toBe("number");
    expect(typeof resolveTargetLimit({ high: undefined } as any, decision({ tier: "high" }), "x", { find: () => ({ contextWindow: 500 } as any) } as any, "x", "y")).toBe("number");
    expect(typeof resolveTargetLimit({ high: undefined } as any, decision({ tier: "high" }), "x", { find: () => undefined } as any, "x", "y")).toBe("number");
    expect(typeof resolveTargetLimit(profile({ high: { models: ["openai/gpt-high"] } as any, medium: { models: ["openai/gpt-medium"] } as any }), decision({ tier: "high" }), "openai/gpt-medium", { find: vi.fn() } as any, "openai", "gpt-medium")).toBe("number");
    expect(typeof resolveTargetLimit({ high: { models: undefined } as any } as any, decision({ tier: "high" }), "x", { find: () => undefined } as any, "x", "y")).toBe("number");
  });
  it("buildEffectiveContext", () => {
    const small: any = { messages: [{ role: "user", content: "hi", timestamp: 1 }] };
    const large: any = { messages: [{ role: "user", content: "a".repeat(5000), timestamp: 1 }, { role: "assistant", content: "b".repeat(5000), timestamp: 2 }] };
    expect(buildEffectiveContext(large, 50, { contextWindow: 100 } as any)).not.toBe(large);
    expect(buildEffectiveContext(small, 200, { contextWindow: 100 } as any)).toBe(small);
    expect(buildEffectiveContext(small, 10, {} as any)).toBe(small);
  });
  it("isContentEvent and collectBufferedResult", () => {
    expect(isContentEvent("text_delta")).toBe(true);
    expect(isContentEvent("done")).toBe(false);
    expect(collectBufferedResult([{ type: "done", message: { usage: { cost: { total: 0.5 } } } }]).pendingCostDelta).toBe(0.5);
    expect(collectBufferedResult([{ type: "error", error: { errorMessage: "e" } }]).bufferedErrorMessage).toBe("e");
    expect(collectBufferedResult([{ type: "text_delta" }]).contentReceived).toBe(true);
    expect(collectBufferedResult([]).gotDone).toBe(false);
    expect(collectBufferedResult([{ type: "done" }]).pendingCostDelta).toBe(0);
    expect(collectBufferedResult([{ type: "error" }]).bufferedErrorMessage).toBeUndefined();
    expect(collectBufferedResult([{ type: "error", error: { errorMessage: 1 } }]).bufferedErrorMessage).toBeUndefined();
    expect(collectBufferedResult([{ type: "error", error: {} }]).bufferedErrorMessage).toBeUndefined();
    const r = collectBufferedResult([
      { type: "done", message: { usage: { cost: { total: 1 } } } },
      { type: "error", error: { errorMessage: "e" } },
      { type: "text_delta" },
    ]);
    expect(r.gotDone && r.gotError && r.contentReceived).toBe(true);
  });
  it("resolveAuthError and shouldSkip", () => {
    expect(resolveAuthError({ ok: false, error: "bad" } as any, "openai", "gpt").message).toContain("Auth failed");
    expect(resolveAuthError({ ok: true } as any, "openai", "gpt").message).toContain("No API key");
    expect(shouldSkipRouterModel("router")).toBe(true);
    expect(shouldSkipRouterModel("openai")).toBe(false);
  });
  it("buildFallbackDecision", () => {
    const d = decision({ thinking: "high" });
    buildFallbackDecision(d, "anthropic/claude#low");
    expect(d.isFallback && d.targetProvider === "anthropic" && d.thinking === "low").toBe(true);
    const d2 = decision({ thinking: "high" });
    buildFallbackDecision(d2, "openai/gpt");
    expect(d2.thinking).toBe("high");
  });
});

describe("attemptSingleModel", () => {
  beforeEach(() => vi.clearAllMocks());
  const base = (over: any = {}) => ({
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
  it("skip router", async () => expect((await attemptSingleModel("router/balanced", 0, base() as any, vi.fn())).status).toBe("skip"));
  it("model not found", async () => expect((await attemptSingleModel("openai/missing", 0, base({ registry: { find: () => undefined, getApiKeyAndHeaders: vi.fn() } as any }) as any, vi.fn())).status).toBe("retry"));
  it("auth failure", async () => {
    const p = base({ registry: { find: () => ({ provider: "openai", id: "gpt-high" } as any), getApiKeyAndHeaders: async () => ({ ok: false, error: "bad" } as any) } as any });
    expect((await attemptSingleModel("openai/gpt-high", 0, p as any, vi.fn())).status).toBe("retry");
  });
  it("aborted before stream", async () => expect((await attemptSingleModel("openai/gpt-high", 0, base({ options: { signal: { aborted: true } as any } as any }) as any, vi.fn())).status).toBe("nonRetryable"));
  it("success and stale UI", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "done", message: { usage: { cost: { total: 0.02 } } } }; })() as any);
    const s: any = { failedByChain: new Map(), lastDecision: { profile: "balanced" } as any, accumulatedCost: 0, lastExtensionContext: { ui: { setHiddenThinkingLabel: vi.fn() } } };
    const r = await attemptSingleModel("openai/gpt-high", 1, base({ state: s }) as any, vi.fn());
    expect(r.status).toBe("success");
    expect(r.costDelta).toBe(0.02);
  });
  it("stale UI throw", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "done", message: { usage: { cost: { total: 0 } } } }; })() as any);
    const s: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: { ui: { setHiddenThinkingLabel: () => { throw new Error("stale"); } } } };
    expect((await attemptSingleModel("openai/gpt-high", 0, base({ state: s }) as any, vi.fn())).status).toBe("success");
  });
  it("with reasoning true", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "done", message: { usage: { cost: { total: 0 } } } }; })() as any);
    const s: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: { ui: { setHiddenThinkingLabel: vi.fn() } } };
    expect((await attemptSingleModel("openai/gpt-high", 0, base({ state: s, decision: decision({ tier: "high", thinking: "high" }), registry: { find: () => ({ provider: "openai", id: "gpt-high", reasoning: true } as any), getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} } as any) } as any }) as any, vi.fn())).status).toBe("success");
  });
  it("aborted during stream", async () => {
    const signal: any = { aborted: false };
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "text_delta" }; signal.aborted = true; yield { type: "text_delta" }; })() as any);
    expect((await attemptSingleModel("openai/gpt-high", 0, base({ options: { signal } as any }) as any, vi.fn())).status).toBe("nonRetryable");
  });
  it("gotError with content -> nonRetryable", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "text_delta" }; yield { type: "error", error: { errorMessage: "fail" } }; })() as any);
    expect((await attemptSingleModel("openai/gpt-high", 0, base() as any, vi.fn())).status).toBe("nonRetryable");
  });
  it("gotError without content -> retry", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "error", error: { errorMessage: "fail" } }; })() as any);
    expect((await attemptSingleModel("openai/gpt-high", 0, base() as any, vi.fn())).status).toBe("retry");
  });
  it("no delegated stream", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => null as any);
    expect((await attemptSingleModel("openai/gpt-high", 0, base() as any, vi.fn())).status).toBe("retry");
  });
  it("no terminal event", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "text_delta" }; })() as any);
    expect((await attemptSingleModel("openai/gpt-high", 0, base() as any, vi.fn())).status).toBe("retry");
  });
  it("model not found not recordable", async () => {
    vi.mocked(isRecordablePreStreamError).mockReturnValueOnce(false);
    const rec = vi.fn();
    expect((await attemptSingleModel("openai/missing", 0, base({ registry: { find: () => undefined, getApiKeyAndHeaders: vi.fn() } as any }) as any, rec)).status).toBe("retry");
    expect(rec).not.toHaveBeenCalled();
  });
  it("auth ok without apiKey", async () => {
    const rec = vi.fn();
    const p = base({ registry: { find: () => ({ provider: "openai", id: "gpt-high" } as any), getApiKeyAndHeaders: async () => ({ ok: true } as any) } as any });
    expect((await attemptSingleModel("openai/gpt-high", 0, p as any, rec)).status).toBe("retry");
    expect(rec).toHaveBeenCalled();
  });
  it("auth failure not recordable", async () => {
    vi.mocked(isRecordablePreStreamError).mockReturnValueOnce(false);
    const rec = vi.fn();
    const p = base({ registry: { find: () => ({ provider: "openai", id: "gpt-high" } as any), getApiKeyAndHeaders: async () => ({ ok: false, error: "bad" } as any) } as any });
    expect((await attemptSingleModel("openai/gpt-high", 0, p as any, rec)).status).toBe("retry");
    expect(rec).not.toHaveBeenCalled();
  });
  it("no delegated stream not recordable", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => null as any);
    vi.mocked(isRecordablePreStreamError).mockReturnValueOnce(false);
    const rec = vi.fn();
    expect((await attemptSingleModel("openai/gpt-high", 0, base() as any, rec)).status).toBe("retry");
    expect(rec).not.toHaveBeenCalled();
  });
  it("gotError with content without message", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "text_delta" }; yield { type: "error" }; })() as any);
    const r = await attemptSingleModel("openai/gpt-high", 0, base() as any, vi.fn());
    expect(r.status).toBe("nonRetryable");
    expect(r.error?.message).toContain("Model failed after sending content.");
  });
  it("gotError without content without message records", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "error" }; })() as any);
    const rec = vi.fn();
    const r = await attemptSingleModel("openai/gpt-high", 0, base() as any, rec);
    expect(r.status).toBe("retry");
    expect(r.error?.message).toBe("Model failed before sending content.");
    expect(rec).toHaveBeenCalled();
  });
  it("no terminal event recordable", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "text_delta" }; })() as any);
    vi.mocked(isRecordablePreStreamError).mockReturnValueOnce(true);
    const rec = vi.fn();
    expect((await attemptSingleModel("openai/gpt-high", 0, base() as any, rec)).status).toBe("retry");
    expect(rec).toHaveBeenCalled();
  });
  it("fallback lastDecision same object", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "done", message: { usage: { cost: { total: 0 } } } }; })() as any);
    const dec = decision({ tier: "high" });
    const s: any = { failedByChain: new Map(), lastDecision: dec, accumulatedCost: 0, lastExtensionContext: { ui: { setHiddenThinkingLabel: vi.fn() } } };
    const r = await attemptSingleModel("openai/gpt-high", 1, base({ decision: dec, state: s }) as any, vi.fn());
    expect(r.status).toBe("success");
    expect(s.lastDecision).not.toBe(dec);
    expect(s.lastDecision.profile).toBe("balanced");
  });
  it("fallback lastDecision other profile", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "done", message: { usage: { cost: { total: 0 } } } }; })() as any);
    const dec = decision({ tier: "high" });
    const s: any = { failedByChain: new Map(), lastDecision: { profile: "other" }, accumulatedCost: 0 };
    const r = await attemptSingleModel("openai/gpt-high", 1, base({ decision: dec, state: s }) as any, vi.fn());
    expect(r.status).toBe("success");
    expect(s.lastDecision).toEqual({ profile: "other" });
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
  it("success via first", async () => {
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
  it("fallback on second", async () => {
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
  it("skips router then succeeds", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "done", message: { usage: { cost: { total: 0 } } } }; })() as any);
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const res = await delegateToTierModels({
      registry: { find: () => ({ provider: "openai", id: "gpt-high", reasoning: false } as any), getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }) } as any,
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
  it("nonRetryable abort without NON_RETRYABLE prefix", async () => {
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const res = await delegateToTierModels({
      registry: { find: () => ({ provider: "openai", id: "gpt-high", reasoning: false } as any), getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }) } as any,
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
  it("retry then exhausted", async () => {
    vi.mocked(streamDelegated).mockImplementation(() => (async function* () { yield { type: "error", error: { errorMessage: "fail" } }; })() as any);
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
    expect((res.lastError as Error).message).toBe("fail");
  });
});
