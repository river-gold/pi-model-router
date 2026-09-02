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
  delegateToTierModels,
} from "../../../src/provider/delegate";
import type { RouterProfile, RoutingDecision } from "../../../src/types";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { streamDelegated } from "../../../src/stream";

vi.mock("../../../src/stream", async () => {
  const actual = (await vi.importActual("../../../src/stream")) as any;
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

describe("delegate helpers", () => {
  it("getInitialModelsToTry returns tier models deduped", () => {
    const p = profile({ high: { models: ["a/b", "a/b", "c/d"] } as any });
    expect(getInitialModelsToTry(p, decision({ tier: "high" }))).toEqual(["a/b", "c/d"]);
  });
  it("getInitialModelsToTry fallback to target when tier missing", () => {
    const p = profile({ high: undefined });
    const d = decision({ tier: "high", targetProvider: "openai", targetModelId: "gpt" });
    expect(getInitialModelsToTry(p, d)).toEqual(["openai/gpt#high"]);
  });
  it("filterByFailureMemory no set", () => {
    expect(filterByFailureMemory(["a/b", "c/d"], undefined)).toEqual({
      filtered: ["a/b", "c/d"],
      skipped: [],
      allFiltered: false,
    });
  });
  it("filterByFailureMemory empty set", () => {
    expect(filterByFailureMemory(["a/b"], new Set())).toEqual({
      filtered: ["a/b"],
      skipped: [],
      allFiltered: false,
    });
  });
  it("filterByFailureMemory with matches", () => {
    const s = new Set(["a/b"]);
    const r = filterByFailureMemory(["a/b", "c/d"], s);
    expect(r.filtered).toEqual(["c/d"]);
    expect(r.skipped).toEqual(["a/b"]);
    expect(r.allFiltered).toBe(false);
  });
  it("filterByFailureMemory all filtered", () => {
    const s = new Set(["a/b", "c/d"]);
    const r = filterByFailureMemory(["a/b", "c/d"], s);
    expect(r.filtered).toEqual([]);
    expect(r.allFiltered).toBe(true);
  });
  it("createRecordFailure adds normalized ref", () => {
    const state: any = { failedByChain: new Map() };
    const rec = createRecordFailure(state, "route:balanced:high");
    rec(" OpenAI/GPT ");
    expect(state.failedByChain.get("route:balanced:high")!.has("OpenAI/GPT")).toBe(true);
    rec("OpenAI/GPT");
    expect(state.failedByChain.get("route:balanced:high")!.size).toBe(1);
  });
  it("resolveTargetLimit finds tier", () => {
    const p = profile({ high: { models: ["openai/gpt-high"] } as any });
    const reg: any = { find: vi.fn() };
    const v = resolveTargetLimit(p, decision({ tier: "high" }), "openai/gpt-high", reg, "openai", "gpt-high");
    expect(typeof v).toBe("number");
    expect(v).toBeGreaterThan(0);
  });
  it("resolveTargetLimit fallback to found contextWindow", () => {
    const p = profile({ high: { models: ["other/model"] } as any });
    const reg: any = { find: vi.fn(() => ({ contextWindow: 5000 })) };
    expect(resolveTargetLimit(p, decision({ tier: "high" }), "openai/gpt-high", reg, "openai", "gpt-high")).toBe(5000);
  });
  it("resolveTargetLimit fallback to decision tier", () => {
    const p = profile({ high: { models: ["other/model"] } as any });
    const reg: any = { find: vi.fn(() => undefined) };
    const v = resolveTargetLimit(p, decision({ tier: "high" }), "openai/gpt-high", reg, "openai", "gpt-high");
    expect(typeof v).toBe("number");
  });
  it("buildEffectiveContext truncates when limit smaller", () => {
    const ctx: any = { messages: [{ role: "user", content: "a".repeat(5000), timestamp: 1 }] };
    const routerModel: any = { contextWindow: 10000 };
    const res = buildEffectiveContext(ctx, 10, routerModel);
    expect(res.messages.length).toBeLessThanOrEqual(1);
  });
  it("buildEffectiveContext no truncation when limit larger", () => {
    const ctx: any = { messages: [{ role: "user", content: "hi", timestamp: 1 }] };
    const routerModel: any = { contextWindow: 100 };
    expect(buildEffectiveContext(ctx, 200, routerModel)).toBe(ctx);
  });
  it("isContentEvent", () => {
    expect(isContentEvent("text_delta")).toBe(true);
    expect(isContentEvent("thinking_delta")).toBe(true);
    expect(isContentEvent("toolcall_delta")).toBe(true);
    expect(isContentEvent("toolcall_end")).toBe(true);
    expect(isContentEvent("done")).toBe(false);
    expect(isContentEvent("error")).toBe(false);
  });
  it("collectBufferedResult done with cost", () => {
    const r = collectBufferedResult([{ type: "done", message: { usage: { cost: { total: 0.5 } } } }]);
    expect(r.gotDone).toBe(true);
    expect(r.pendingCostDelta).toBe(0.5);
  });
  it("collectBufferedResult error with message", () => {
    const r = collectBufferedResult([{ type: "error", error: { errorMessage: "oops" } }]);
    expect(r.gotError).toBe(true);
    expect(r.bufferedErrorMessage).toBe("oops");
  });
  it("collectBufferedResult error without message", () => {
    const r = collectBufferedResult([{ type: "error", error: {} }]);
    expect(r.gotError).toBe(true);
    expect(r.bufferedErrorMessage).toBeUndefined();
  });
  it("collectBufferedResult content received", () => {
    const r = collectBufferedResult([{ type: "text_delta", delta: "hi" }]);
    expect(r.contentReceived).toBe(true);
  });
  it("collectBufferedResult empty", () => {
    const r = collectBufferedResult([]);
    expect(r.gotDone).toBe(false);
    expect(r.gotError).toBe(false);
  });
  it("resolveAuthError auth ok false", () => {
    expect(resolveAuthError({ ok: false, error: "bad" } as any, "openai", "gpt").message).toContain("Auth failed");
  });
  it("resolveAuthError no apiKey", () => {
    expect(resolveAuthError({ ok: true } as any, "openai", "gpt").message).toContain("No API key");
  });
  it("shouldSkipRouterModel", () => {
    expect(shouldSkipRouterModel("router")).toBe(true);
    expect(shouldSkipRouterModel("openai")).toBe(false);
  });
  it("buildFallbackDecision mutates decision", () => {
    const d = decision({ tier: "high", targetProvider: "openai", targetModelId: "old" });
    buildFallbackDecision(d, "anthropic/claude#low");
    expect(d.isFallback).toBe(true);
    expect(d.targetProvider).toBe("anthropic");
    expect(d.targetModelId).toBe("claude");
    expect(d.thinking).toBe("low");
  });
  it("buildFallbackDecision without thinking keeps original", () => {
    const d = decision({ tier: "high", thinking: "high" });
    buildFallbackDecision(d, "openai/gpt");
    expect(d.thinking).toBe("high");
  });
});

describe("delegateToTierModels integration", () => {
  beforeEach(() => vi.clearAllMocks());

  const makeRegistry = (over: any = {}) => ({
    find: vi.fn((p: string, id: string) => {
      if (p === "openai" && id === "gpt-high") return { provider: p, id, contextWindow: 1000 } as any;
      if (p === "openai" && id === "gpt-fallback") return { provider: p, id, contextWindow: 1000 } as any;
      return undefined;
    }),
    getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "k", headers: {} })),
    ...over,
  });

  it("all filtered throws", async () => {
    const state: any = { failedByChain: new Map([["route:balanced:high", new Set(["openai/gpt-high"])]]), lastDecision: undefined, accumulatedCost: 0 };
    const reg = makeRegistry();
    const stream: any = { push: vi.fn() };
    await expect(
      delegateToTierModels({
        registry: reg as any,
        profile: profile({ high: { models: ["openai/gpt-high"] } as any }),
        decision: decision({ tier: "high" }),
        routerModel: { contextWindow: 10000 } as any,
        context: { messages: [] } as any,
        state,
        withCommitMutex: async (fn: any) => fn(),
        stream,
        recordDebugDecision: vi.fn(),
      }),
    ).rejects.toThrow("All models in high tier are marked failed");
  });

  it("skips router model", async () => {
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const reg = makeRegistry({ find: vi.fn(() => undefined) });
    const stream: any = { push: vi.fn() };
    const res = await delegateToTierModels({
      registry: reg as any,
      profile: profile({ high: { models: ["router/balanced", "openai/gpt-high"] } as any }),
      decision: decision({ tier: "high" }),
      routerModel: { contextWindow: 10000 } as any,
      context: { messages: [] } as any,
      state,
      withCommitMutex: async (fn: any) => fn(),
      stream,
      recordDebugDecision: vi.fn(),
    });
    expect(res.success).toBe(false);
  });

  it("model not found records failure", async () => {
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const reg = makeRegistry({ find: vi.fn(() => undefined) });
    const stream: any = { push: vi.fn() };
    const res = await delegateToTierModels({
      registry: reg as any,
      profile: profile({ high: { models: ["openai/missing"] } as any }),
      decision: decision({ tier: "high" }),
      routerModel: { contextWindow: 10000 } as any,
      context: { messages: [] } as any,
      state,
      withCommitMutex: async (fn: any) => fn(),
      stream,
      recordDebugDecision: vi.fn(),
    });
    expect(res.success).toBe(false);
    expect(res.lastError).toBeDefined();
  });

  it("auth failure records", async () => {
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const reg = makeRegistry({ getApiKeyAndHeaders: async () => ({ ok: false, error: "bad" } as any) });
    const stream: any = { push: vi.fn() };
    const res = await delegateToTierModels({
      registry: reg as any,
      profile: profile({ high: { models: ["openai/gpt-high"] } as any }),
      decision: decision({ tier: "high" }),
      routerModel: { contextWindow: 10000 } as any,
      context: { messages: [] } as any,
      state,
      withCommitMutex: async (fn: any) => fn(),
      stream,
      recordDebugDecision: vi.fn(),
    });
    expect(res.success).toBe(false);
  });

  it("aborted signal throws", async () => {
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const reg = makeRegistry();
    const stream: any = { push: vi.fn() };
    await expect(
      delegateToTierModels({
        registry: reg as any,
        profile: profile({ high: { models: ["openai/gpt-high"] } as any }),
        decision: decision({ tier: "high" }),
        routerModel: { contextWindow: 10000 } as any,
        context: { messages: [] } as any,
        options: { signal: { aborted: true } as any } as any,
        state,
        withCommitMutex: async (fn: any) => fn(),
        stream,
        recordDebugDecision: vi.fn(),
      }),
    ).rejects.toThrow("aborted");
  });

  it("gotDone success with cost and fallback", async () => {
    const state: any = {
      failedByChain: new Map(),
      lastDecision: decision({ profile: "balanced", tier: "medium" }),
      accumulatedCost: 0,
      lastExtensionContext: { ui: { setHiddenThinkingLabel: vi.fn() } },
    };
    const reg: any = {
      find: vi.fn((p: string, id: string) => ({ provider: p, id, contextWindow: 1000, reasoning: false } as any)),
      getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "k", headers: {} })),
    };
    // need streamDelegated mock
    vi.mocked(streamDelegated).mockImplementation(() => {
      return (async function* () {
        yield { type: "text_delta", delta: "hi" };
        yield { type: "done", message: { usage: { cost: { total: 0.01 } } } };
      })() as any;
    });
    const stream: any = { push: vi.fn() };
    const res = await delegateToTierModels({
      registry: reg,
      profile: profile({
        high: { models: ["openai/gpt-high", "openai/gpt-fallback"] } as any,
      }),
      decision: decision({ tier: "high", targetProvider: "openai", targetModelId: "gpt-high" }),
      routerModel: { contextWindow: 10000 } as any,
      context: { messages: [{ role: "user", content: "hi", timestamp: 1 } as any] } as any,
      state,
      withCommitMutex: async (fn: any) => fn(),
      stream,
      recordDebugDecision: vi.fn(),
    });
    // first model should succeed, no fallback
    expect(res.success).toBe(true);
    expect(res.costDelta).toBe(0.01);
  });

  it("gotError with content becomes NON_RETRYABLE", async () => {
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const reg: any = {
      find: vi.fn(() => ({ provider: "openai", id: "gpt-high", reasoning: false } as any)),
      getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "k", headers: {} })),
    };
    vi.mocked(streamDelegated).mockImplementation(() => {
      return (async function* () {
        yield { type: "text_delta", delta: "hi" };
        yield { type: "error", error: { errorMessage: "fail after content" } };
      })() as any;
    });
    const stream: any = { push: vi.fn() };
    const res = await delegateToTierModels({
      registry: reg,
      profile: profile({ high: { models: ["openai/gpt-high"] } as any }),
      decision: decision({ tier: "high" }),
      routerModel: { contextWindow: 10000 } as any,
      context: { messages: [] } as any,
      state,
      withCommitMutex: async (fn: any) => fn(),
      stream,
      recordDebugDecision: vi.fn(),
    });
    expect(res.success).toBe(false);
    expect((res.lastError as Error).message).toContain("fail after content");
  });

  it("gotError without content retries", async () => {
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const reg: any = {
      find: vi.fn(() => ({ provider: "openai", id: "gpt-high", reasoning: false } as any)),
      getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "k", headers: {} })),
    };
    vi.mocked(streamDelegated).mockImplementation(() => {
      return (async function* () {
        yield { type: "error", error: { errorMessage: "fail before" } };
      })() as any;
    });
    const stream: any = { push: vi.fn() };
    const res = await delegateToTierModels({
      registry: reg,
      profile: profile({ high: { models: ["openai/gpt-high"] } as any }),
      decision: decision({ tier: "high" }),
      routerModel: { contextWindow: 10000 } as any,
      context: { messages: [] } as any,
      state,
      withCommitMutex: async (fn: any) => fn(),
      stream,
      recordDebugDecision: vi.fn(),
    });
    expect(res.success).toBe(false);
  });

  it("no terminal event throws", async () => {
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const reg: any = {
      find: vi.fn(() => ({ provider: "openai", id: "gpt-high", reasoning: false } as any)),
      getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "k", headers: {} })),
    };
    vi.mocked(streamDelegated).mockImplementation(() => {
      return (async function* () {
        yield { type: "text_delta", delta: "hi" };
      })() as any;
    });
    const stream: any = { push: vi.fn() };
    const res = await delegateToTierModels({
      registry: reg,
      profile: profile({ high: { models: ["openai/gpt-high"] } as any }),
      decision: decision({ tier: "high" }),
      routerModel: { contextWindow: 10000 } as any,
      context: { messages: [] } as any,
      state,
      withCommitMutex: async (fn: any) => fn(),
      stream,
      recordDebugDecision: vi.fn(),
    });
    expect(res.success).toBe(false);
  });

  it("delegatedStream null", async () => {
    const state: any = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0 };
    const reg: any = {
      find: vi.fn(() => ({ provider: "openai", id: "gpt-high", reasoning: false } as any)),
      getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "k", headers: {} })),
    };
    vi.mocked(streamDelegated).mockImplementation(() => null as any);
    const stream: any = { push: vi.fn() };
    const res = await delegateToTierModels({
      registry: reg,
      profile: profile({ high: { models: ["openai/gpt-high"] } as any }),
      decision: decision({ tier: "high" }),
      routerModel: { contextWindow: 10000 } as any,
      context: { messages: [] } as any,
      state,
      withCommitMutex: async (fn: any) => fn(),
      stream,
      recordDebugDecision: vi.fn(),
    });
    expect(res.success).toBe(false);
  });
});
