/* oxlint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Api, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterProfile, RoutingDecision } from "../src/types";
import { delegateToTierModels } from "../src/provider/delegate";
import * as streamMod from "../src/stream";
import * as ctxMod from "../src/context";
import * as cfgMod from "../src/config";

const routerModel = (cw = 100000) =>
  ({ id: "balanced", provider: "router", api: "a" as Api, contextWindow: cw }) as unknown as Model<Api>;

const makeContext = (msgs: unknown[] = [{ role: "user", content: "hi" }]) =>
  ({ messages: msgs, systemPrompt: "sys" }) as unknown as Context;

const baseDecision = (over: Partial<RoutingDecision> = {}): RoutingDecision =>
  ({
    profile: "balanced",
    tier: "medium" as const,
    targetProvider: "openai",
    targetModelId: "gpt-4o",
    targetLabel: "openai/gpt-4o",
    reasoning: "test",
    thinking: "medium" as unknown as string,
    timestamp: Date.now(),
    ...over,
  }) as unknown as RoutingDecision;

const makeStream = () => {
  const events: unknown[] = [];
  return {
    push: (e: unknown) => events.push(e),
    end: vi.fn(),
    events,
  } as unknown as ReturnType<typeof import("@earendil-works/pi-ai").createAssistantMessageEventStream> & { events: unknown[] };
};

const makeRegistry = (over: Partial<Record<string, unknown>> = {}) => {
  const find = vi.fn((p: string, id: string) => ({ provider: p, id, contextWindow: 8000, maxTokens: 4000, reasoning: true, baseUrl: "https://api" } as unknown as Model<Api>));
  const getApiKeyAndHeaders = vi.fn(async () => ({ ok: true as const, apiKey: "k", headers: {} }));
  const getProvider = vi.fn(() => ({ streamSimple: vi.fn() }));
  return {
    find,
    getApiKeyAndHeaders,
    getProvider,
    ...over,
  } as unknown as ExtensionContext["modelRegistry"] & { find: ReturnType<typeof vi.fn>; getApiKeyAndHeaders: ReturnType<typeof vi.fn>; getProvider: ReturnType<typeof vi.fn> };
};

const asyncGen = function* (events: unknown[]) {
  // helper to create async iterable
  return (async function* () {
    for (const e of events) yield e as never;
  })();
};

describe("delegateToTierModels", () => {
  let streamDelegatedSpy: ReturnType<typeof vi.spyOn>;
  let truncateSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.restoreAllMocks();
    streamDelegatedSpy = vi.spyOn(streamMod, "streamDelegated");
    truncateSpy = vi.spyOn(ctxMod, "truncateContext");
    // default truncate mocks return truncated context
    truncateSpy.mockImplementation((ctx: Context, limit: number) => ({ ...ctx, truncated: true, _limit: limit } as unknown as Context));
  });

  it("modelsToTry empty fallback uses decision target via formatModelRef", async () => {
    const profile: RouterProfile = {} as RouterProfile;
    const decision = baseDecision({ tier: "medium" as const, targetProvider: "openai", targetModelId: "fallback-model", thinking: undefined });
    const registry = makeRegistry();
    const targetModel = { provider: "openai", id: "fallback-model", contextWindow: 5000, reasoning: false } as unknown as Model<Api>;
    registry.find = vi.fn((p: string, id: string) => (id === "fallback-model" ? targetModel : undefined)) as unknown as typeof registry.find;
    const delegatedStream = (async function* () {
      yield { type: "text_delta", delta: "hi" };
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegatedStream);
    const state = { failedByChain: new Map<string, Set<string>>(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const result = await delegateToTierModels({
      registry,
      profile,
      decision,
      routerModel: routerModel(),
      context: makeContext(),
      options: {},
      state: state as unknown as Parameters<typeof delegateToTierModels>[0]["state"],
      withCommitMutex: async (fn) => fn(),
      stream,
      recordDebugDecision: vi.fn(),
    });
    expect(result.success).toBe(true);
    expect(streamDelegatedSpy).toHaveBeenCalled();
  });

  it("routeFailedSet null does not filter", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a", "openai/b"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const delegated = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
    // ensure no throw, modelsToTry length 2 but first succeeds
  });

  it("routeFailedSet empty does not filter", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a", "openai/b"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const state = { failedByChain: new Map([["route:balanced:medium", new Set<string>()]]), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const delegated = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    const stream = makeStream();
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
  });

  it("routeFailedSet with partial matches filters skippedDueToMemory", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a", "openai/b", "openai/c"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    // only a is failed, should skip a and succeed on b
    const state = { failedByChain: new Map([["route:balanced:medium", new Set(["openai/a"])]]), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const delegated = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    const stream = makeStream();
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
    // b should be the delegated model (a filtered)
    expect(streamDelegatedSpy).toHaveBeenCalledTimes(1);
    const reqModel = (streamDelegatedSpy.mock.calls[0][1] as unknown as Model<Api>);
    expect(reqModel.id).toBe("b");
  });

  it("routeFailedSet with all matches throws", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a", "openai/b"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const state = { failedByChain: new Map([["route:balanced:medium", new Set(["openai/a", "openai/b"])]]), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    await expect(
      delegateToTierModels({
        registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
      }),
    ).rejects.toThrow("All models in medium tier are marked failed");
  });

  it("targetProvider router continues", async () => {
    const profile: RouterProfile = { medium: { models: ["router/other", "openai/real"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const delegated = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
    expect(streamDelegatedSpy).toHaveBeenCalledTimes(1);
    const reqModel2 = (streamDelegatedSpy.mock.calls[0][1] as unknown as Model<Api>);
    expect(reqModel2.id).toBe("real");
  });

  it("targetModel not found records and continues", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/missing", "openai/found"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const foundModel = { provider: "openai", id: "found", reasoning: true, contextWindow: 8000 } as unknown as Model<Api>;
    const registry = makeRegistry();
    registry.find = vi.fn((p: string, id: string) => (id === "found" ? foundModel : undefined)) as unknown as typeof registry.find;
    const delegated = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
    // recorded failure for missing
    expect(state.failedByChain.get("route:balanced:medium")?.has("openai/missing")).toBe(true);
  });

  it("auth ok false records Auth failed", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a", "openai/b"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    registry.getApiKeyAndHeaders = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: "401 unauthorized", apiKey: undefined, headers: {} } as unknown)
      .mockResolvedValueOnce({ ok: true, apiKey: "k", headers: {} } as unknown) as unknown as typeof registry.getApiKeyAndHeaders;
    const delegated = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
    expect(state.failedByChain.get("route:balanced:medium")?.has("openai/a")).toBe(true);
  });

  it("auth ok true but no apiKey records No API key", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a", "openai/b"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    registry.getApiKeyAndHeaders = vi.fn()
      .mockResolvedValueOnce({ ok: true, apiKey: undefined, headers: {} } as unknown)
      .mockResolvedValueOnce({ ok: true, apiKey: "k", headers: {} } as unknown) as unknown as typeof registry.getApiKeyAndHeaders;
    const delegated = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
    expect(state.failedByChain.get("route:balanced:medium")?.has("openai/a")).toBe(true);
  });

  it("signal aborted before delegation throws", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const ac = new AbortController(); ac.abort();
    await expect(
      delegateToTierModels({
        registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: { signal: ac.signal } as SimpleStreamOptions, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
      }),
    ).rejects.toThrow("aborted");
  });

  it("signal aborted inside stream with contentReceived true breaks via outer catch", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const ac = new AbortController();
    // delegated stream yields content then abort check should throw
    const delegated = (async function* () {
      yield { type: "text_delta", delta: "hello" };
      ac.abort();
      yield { type: "text_delta", delta: "world" };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: { signal: ac.signal } as SimpleStreamOptions, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(false);
    expect(r.lastError).toBeInstanceOf(Error);
    expect((r.lastError as Error).message).toBe("aborted");
  });

  it("effectiveContext truncation when targetLimit < routerModel.contextWindow", async () => {
    const profile: RouterProfile = {
      medium: { models: ["openai/a"], contextWindow: 100, resolvedContextWindow: 100 } as unknown,
    } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    // ensure resolveContextWindow returns profile's 100
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const delegated = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(200000), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(truncateSpy).toHaveBeenCalled();
  });

  it("no truncation when targetLimit >= routerModel.contextWindow", async () => {
    const profile: RouterProfile = {
      medium: { models: ["openai/a"], contextWindow: 500000, resolvedContextWindow: 500000 } as unknown,
    } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const delegated = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    truncateSpy.mockClear();
    await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(1000), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(truncateSpy).not.toHaveBeenCalled();
  });

  it("tierForModel not found branch uses registry.find contextWindow", async () => {
    // profile tier missing -> fallback model not in profile
    const profile: RouterProfile = {} as RouterProfile;
    const decision = baseDecision({ tier: "medium" as const, targetProvider: "openai", targetModelId: "external", thinking: undefined });
    const registry = makeRegistry();
    const extModel = { provider: "openai", id: "external", contextWindow: 12345, reasoning: false } as unknown as Model<Api>;
    registry.find = vi.fn((p: string, id: string) => (id === "external" ? extModel : undefined)) as unknown as typeof registry.find;
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const delegated = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    // router small window, targetLimit larger -> no truncation, but branch exercised
    await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(2000), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(registry.find).toHaveBeenCalledWith("openai", "external");
    // truncate not called because targetLimit 12345 > 2000? Actually router 2000 < 12345 so no truncation, but tierForModel not found path covered
  });

  it("tierForModel not found with no found contextWindow falls back to resolveContextWindow", async () => {
    const profile: RouterProfile = {} as RouterProfile;
    const decision = baseDecision({ tier: "medium" as const, targetProvider: "openai", targetModelId: "ext2", thinking: undefined });
    const modelNoWindow = { provider: "openai", id: "ext2", reasoning: false } as unknown as Model<Api>;
    const registry = makeRegistry();
    registry.find = vi.fn(() => modelNoWindow) as unknown as typeof registry.find;
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const delegated = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
    expect(registry.find).toHaveBeenCalled();
  });

  it("delegatedReasoning true sets hidden label with args", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a"] } as unknown } as RouterProfile;
    const decision = baseDecision({ thinking: "high" as unknown as string });
    const targetModel = { provider: "openai", id: "a", contextWindow: 8000, reasoning: true } as unknown as Model<Api>;
    const registry = makeRegistry();
    registry.find = vi.fn(() => targetModel) as unknown as typeof registry.find;
    const setHidden = vi.fn();
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: { ui: { setHiddenThinkingLabel: setHidden } } as unknown as ExtensionContext };
    const stream = makeStream();
    const delegated = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(setHidden).toHaveBeenCalledWith(expect.stringContaining("openai/a"));
  });

  it("delegatedReasoning false sets hidden label without args", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a"] } as unknown } as RouterProfile;
    const decision = baseDecision({ thinking: undefined });
    const targetModel = { provider: "openai", id: "a", contextWindow: 8000, reasoning: false } as unknown as Model<Api>;
    const registry = makeRegistry();
    registry.find = vi.fn(() => targetModel) as unknown as typeof registry.find;
    const setHidden = vi.fn();
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: { ui: { setHiddenThinkingLabel: setHidden } } as unknown as ExtensionContext };
    const stream = makeStream();
    const delegated = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(setHidden).toHaveBeenCalledWith();
  });

  it("stale ui throws is caught", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a"] } as unknown } as RouterProfile;
    const decision = baseDecision({ thinking: "high" as unknown as string });
    const targetModel = { provider: "openai", id: "a", contextWindow: 8000, reasoning: true } as unknown as Model<Api>;
    const registry = makeRegistry();
    registry.find = vi.fn(() => targetModel) as unknown as typeof registry.find;
    const setHidden = vi.fn(() => { throw new Error("stale context"); });
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: { ui: { setHiddenThinkingLabel: setHidden } } as unknown as ExtensionContext };
    const stream = makeStream();
    const delegated = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
  });

  it("no lastExtensionContext does not call ui", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const delegated = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
  });

  it("delegatedStream null throws recordable", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a", "openai/b"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    streamDelegatedSpy.mockReturnValueOnce(null as unknown as ReturnType<typeof streamMod.streamDelegated>);
    const delegated2 = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValueOnce(delegated2);
    // Actually we have 2 models, first will get null, second succeeds
    // need second call to succeed after first null error
    // Setup mock to return null first then success
    let call = 0;
    streamDelegatedSpy.mockImplementation(() => {
      call++;
      if (call === 1) return null as unknown as ReturnType<typeof streamMod.streamDelegated>;
      return delegated2;
    });
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
    expect(state.failedByChain.get("route:balanced:medium")?.has("openai/a")).toBe(true);
  });

  it("gotDone with costDelta 0 does not call withCommitMutex for cost", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const withCommitMutex = vi.fn(async (fn: () => unknown) => fn() as unknown);
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const delegated = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: withCommitMutex as unknown as typeof withCommitMutex, stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
    expect(r.costDelta).toBe(0);
    expect(withCommitMutex).not.toHaveBeenCalled();
    expect(stream.events.some((e) => (e as { type: string }).type === "done")).toBe(true);
  });

  it("gotDone with costDelta >0 commits via withCommitMutex", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const delegated = (async function* () {
      yield { type: "text_delta", delta: "hi" };
      yield { type: "done", message: { usage: { cost: { total: 0.005 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
    expect(r.costDelta).toBe(0.005);
    expect(state.accumulatedCost).toBe(0.005);
  });

  it("fallback isFallback true i>0 mutates decision and records", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/first", "openai/second"] } as unknown } as RouterProfile;
    const decision = baseDecision({ thinking: "low" as unknown as string });
    const registry = makeRegistry();
    registry.find = vi.fn((p: string, id: string) => ({ provider: p, id, contextWindow: 8000, reasoning: true } as unknown as Model<Api>)) as unknown as typeof registry.find;
    // first model fails pre-content, second succeeds
    let call = 0;
    streamDelegatedSpy.mockImplementation(() => {
      call++;
      if (call === 1) {
        return (async function* () { yield { type: "error", error: { errorMessage: "fail1" } }; })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
      }
      return (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0.002 } } } };
      })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    });
    const state = { failedByChain: new Map(), lastDecision: { profile: "balanced", tier: "medium" } as unknown as RoutingDecision, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const record = vi.fn();
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: record,
    });
    expect(r.success).toBe(true);
    expect(decision.isFallback).toBe(true);
    expect(decision.targetProvider).toBe("openai");
    expect(decision.targetModelId).toBe("second");
    expect(record).toHaveBeenCalledWith(decision);
    expect(state.lastDecision?.targetModelId).toBe("second");
  });

  it("fallback preserves ref thinking or falls back to decision thinking", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a#high", "openai/b"] } as unknown } as RouterProfile;
    // first model reference has #high, but we test second model with no thinking uses decision thinking
    // Make first fail, second succeed
    const decision = baseDecision({ thinking: "medium" as unknown as string });
    const registry = makeRegistry();
    let call = 0;
    streamDelegatedSpy.mockImplementation(() => {
      call++;
      if (call === 1) {
        return (async function* () { yield { type: "error", error: { errorMessage: "x" } }; })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
      }
      return (async function* () { yield { type: "done", message: { usage: { cost: { total: 0 } } } }; })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    });
    const state = { failedByChain: new Map(), lastDecision: decision, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
    // second model ref has no thinking, so ft undefined -> decision.thinking remains original medium
    expect(decision.thinking).toBe("medium");
  });

  it("gotError with content true pushes buffered and NON_RETRYABLE break", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const delegated = (async function* () {
      yield { type: "text_delta", delta: "part" };
      yield { type: "error", error: { errorMessage: "fail after content" } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(false);
    expect((r.lastError as Error).message).toBe("fail after content");
    expect(stream.events.some((e) => (e as { type: string }).type === "text_delta")).toBe(true);
  });

  it("gotError with content true but no errorMessage uses default", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const delegated = (async function* () {
      yield { type: "thinking_delta", delta: "th" };
      yield { type: "error", error: { errorMessage: 123 as unknown } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect((r.lastError as Error).message).toBe("Model failed after sending content.");
  });

  it("gotError with content false throws before content recordable", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a", "openai/b"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    let call = 0;
    streamDelegatedSpy.mockImplementation(() => {
      call++;
      if (call === 1) {
        return (async function* () {
          yield { type: "error", error: { errorMessage: "Model failed before sending content." } };
        })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
      }
      return (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    });
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
    expect(state.failedByChain.get("route:balanced:medium")?.has("openai/a")).toBe(true);
  });

  it("gotError without bufferedErrorMessage uses default", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a", "openai/b"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    let call = 0;
    streamDelegatedSpy.mockImplementation(() => {
      call++;
      if (call === 1) {
        return (async function* () {
          yield { type: "error", error: {} };
        })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
      }
      return (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    });
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
  });

  it("stream without terminal event throws", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a", "openai/b"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    let call = 0;
    streamDelegatedSpy.mockImplementation(() => {
      call++;
      if (call === 1) {
        return (async function* () {
          yield { type: "text_delta", delta: "orphan" };
          // no done/error -> without terminal
        })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
        // This has contentReceived true -> outer catch will break without retry
      }
      return (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    });
    // For this case, first try has contentReceived true and no terminal -> inner throws "without terminal" then outer catch sees contentReceived true -> break with lastError
    // So it will NOT retry second model. Let's test that behavior with single model
    const profile2: RouterProfile = { medium: { models: ["openai/a"] } as unknown } as RouterProfile;
    streamDelegatedSpy.mockReturnValue((async function* () {
      yield { type: "text_delta", delta: "only" };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>);
    const r = await delegateToTierModels({
      registry, profile: profile2, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(false);
    expect((r.lastError as Error).message).toContain("without terminal");
  });

  it("stream without terminal event retry when no content", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a", "openai/b"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    let call = 0;
    streamDelegatedSpy.mockImplementation(() => {
      call++;
      if (call === 1) {
        return (async function* () {
          // no content, no terminal
        })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
      }
      return (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    });
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
  });

  it("contentReceivedForTry via toolcall_delta and toolcall_end", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const delegated = (async function* () {
      yield { type: "toolcall_delta", delta: "x" };
      yield { type: "error", error: { errorMessage: "tool fail" } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(false);
    expect((r.lastError as Error).message).toBe("tool fail");

    // toolcall_end variant
    const delegated2 = (async function* () {
      yield { type: "toolcall_end" };
      yield { type: "error", error: { errorMessage: "tool end fail" } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    const state2 = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream2 = makeStream();
    streamDelegatedSpy.mockReturnValue(delegated2);
    const r2 = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state2 as unknown as never, withCommitMutex: async (fn) => fn(), stream: stream2, recordDebugDecision: vi.fn(),
    });
    expect(r2.success).toBe(false);
  });

  it("isRecordablePreStreamError false not recorded (generic error)", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a", "openai/b"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    let call = 0;
    streamDelegatedSpy.mockImplementation(() => {
      call++;
      if (call === 1) {
        return (async function* () { throw new Error("some random error"); })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
      }
      return (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    });
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
    expect(state.failedByChain.get("route:balanced:medium")).toBeUndefined();
  });

  it("dedup modelsToTry via Set", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a", "openai/a", "openai/b"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const delegated = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
    // dedup ensures only 2 unique models, first succeeds; each success involves 2 find calls (targetModel + resolveContextWindow)
    expect(registry.find).toHaveBeenCalledTimes(2);
  });

  it("delegationOptions strips reasoning and forwards apiKey/headers", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a"] } as unknown } as RouterProfile;
    const decision = baseDecision({ thinking: undefined });
    const targetModel = { provider: "openai", id: "a", contextWindow: 8000, reasoning: false } as unknown as Model<Api>;
    const registry = makeRegistry();
    registry.find = vi.fn(() => targetModel) as unknown as typeof registry.find;
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const delegated = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: { reasoning: "high" as unknown as string, signal: undefined } as unknown as SimpleStreamOptions, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(streamDelegatedSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ apiKey: "k", headers: {} }),
    );
    const opts = streamDelegatedSpy.mock.calls[0][3] as Record<string, unknown>;
    expect(opts.reasoning).toBeUndefined();
  });

  it("delegatedReasoning forwarded when present", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a"] } as unknown } as RouterProfile;
    const decision = baseDecision({ thinking: "high" as unknown as string });
    const targetModel = { provider: "openai", id: "a", reasoning: true, contextWindow: 8000 } as unknown as Model<Api>;
    const registry = makeRegistry();
    registry.find = vi.fn(() => targetModel) as unknown as typeof registry.find;
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const delegated = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    const opts = streamDelegatedSpy.mock.calls[0][3] as Record<string, unknown>;
    expect(opts.reasoning).toBe("high");
  });

  it("handles done event without cost total and thinking_delta content", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const delegated = (async function* () {
      yield { type: "thinking_delta", delta: "hmm" };
      yield { type: "done", message: { usage: {} } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    // thinking_delta counts as content, but stream ends with done, so success. costDelta defaults to 0, so no mutex.
    // However our first test with thinking_delta after done would be treated as success, not error.
    // The stream currently yields thinking before done, so gotDone true, contentReceived true, but still success.
    expect(r.success).toBe(true);
    expect(r.costDelta).toBe(0);
  });

  it("error event with non-object error does not extract bufferedErrorMessage", async () => {
    const profile: RouterProfile = { medium: { models: ["openai/a", "openai/b"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    let call = 0;
    streamDelegatedSpy.mockImplementation(() => {
      call++;
      if (call === 1) {
        return (async function* () {
          yield { type: "error", error: "string error" };
        })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
      }
      return (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    });
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
  });

  it("covers isRecordable false branches for targetModel and auth, and recordRouteFailure second set branch", async () => {
    const fm = await import("../src/failureMemory");
    const spy = vi.spyOn(fm, "isRecordablePreStreamError");
    // make first call true, second call false to cover both branches
    spy.mockReturnValueOnce(true).mockReturnValueOnce(false).mockReturnValueOnce(true).mockReturnValueOnce(false);
    const profile: RouterProfile = { medium: { models: ["openai/missing1", "openai/missing2", "openai/ok"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    registry.find = vi.fn((p: string, id: string) => {
      if (id === "ok") return { provider: p, id, contextWindow: 8000, reasoning: true } as unknown as Model<Api>;
      return undefined;
    }) as unknown as typeof registry.find;
    // also need auth branch cover: make a profile with 2 models where first requires auth false but isRecordable false
    // We'll test targetModel false branch already via missing1/missing2 above (first true -> records, second false -> not record)
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const delegated = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
    // second set branch: state.failedByChain already has entry, so recordRouteFailure second time goes to !s false path
    // The second missing2 was false, so only first missing1 recorded, but we also need to cover the case where second recording hits existing set
    // Trigger again with mock that returns true for both
    spy.mockRestore();
    const spy2 = vi.spyOn(fm, "isRecordablePreStreamError").mockReturnValue(true);
    const profile2: RouterProfile = { medium: { models: ["openai/x", "openai/y", "openai/ok2"] } as unknown } as RouterProfile;
    const decision2 = baseDecision();
    const registry2 = makeRegistry();
    registry2.find = vi.fn((p: string, id: string) => (id === "ok2" ? ({ provider: p, id, contextWindow: 8000, reasoning: true } as unknown as Model<Api>) : undefined)) as unknown as typeof registry2.find;
    const state2 = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream2 = makeStream();
    streamDelegatedSpy.mockReturnValue(delegated);
    await delegateToTierModels({
      registry: registry2, profile: profile2, decision: decision2, routerModel: routerModel(), context: makeContext(), options: {}, state: state2 as unknown as never, withCommitMutex: async (fn) => fn(), stream: stream2, recordDebugDecision: vi.fn(),
    });
    expect(state2.failedByChain.get("route:balanced:medium")?.has("openai/x")).toBe(true);
    expect(state2.failedByChain.get("route:balanced:medium")?.has("openai/y")).toBe(true);
    spy2.mockRestore();
  });

  it("covers auth isRecordable false branch", async () => {
    const fm = await import("../src/failureMemory");
    const spy = vi.spyOn(fm, "isRecordablePreStreamError").mockReturnValue(false);
    const profile: RouterProfile = { medium: { models: ["openai/authfail", "openai/ok"] } as unknown } as RouterProfile;
    const decision = baseDecision();
    const registry = makeRegistry();
    registry.getApiKeyAndHeaders = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: "nope", apiKey: undefined, headers: {} } as unknown)
      .mockResolvedValueOnce({ ok: true, apiKey: "k", headers: {} } as unknown) as unknown as typeof registry.getApiKeyAndHeaders;
    const state = { failedByChain: new Map(), lastDecision: undefined, accumulatedCost: 0, lastExtensionContext: undefined };
    const stream = makeStream();
    const delegated = (async function* () {
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as ReturnType<typeof streamMod.streamDelegated>;
    streamDelegatedSpy.mockReturnValue(delegated);
    const r = await delegateToTierModels({
      registry, profile, decision, routerModel: routerModel(), context: makeContext(), options: {}, state: state as unknown as never, withCommitMutex: async (fn) => fn(), stream, recordDebugDecision: vi.fn(),
    });
    expect(r.success).toBe(true);
    expect(state.failedByChain.get("route:balanced:medium")).toBeUndefined();
    spy.mockRestore();
  });
});
