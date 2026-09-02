/* oxlint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { registerRouterProvider } from "./provider";
import type { Api, Model, Context } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterConfig } from "./types";

vi.mock("@earendil-works/pi-ai", () => ({ createAssistantMessageEventStream: vi.fn() }));
const streamSimple = vi.fn();

// helper to build registry with custom find
const buildRegistry = (opts: any = {}) =>
  ({
    find: vi.fn((p: string, id: string) => {
      if (opts.find) return opts.find(p, id);
      if (p === "openai" || p === "google")
        return {
          provider: p,
          id,
          input: ["text"],
          contextWindow: opts.contextWindow ?? 5000,
          maxTokens: 1000,
          reasoning: true,
        } as any;
      return undefined;
    }),
    getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "k", headers: {} })),
    getProvider: () => ({ streamSimple }),
  }) as any;

class MockStream {
  events: any[] = [];
  push(e: any) {
    this.events.push(e);
  }
  end() {}
}

describe("provider boost2", () => {
  let pi: any, state: any, actions: any, opts: any;
  beforeEach(() => {
    vi.clearAllMocks();
    pi = {
      registerProvider: vi.fn((name: string, o: any) => {
        opts = o;
      }),
      getThinkingLevel: vi.fn().mockReturnValue("off"),
    } as any;
  });

  it("covers maxContextWindow > DEFAULT (129-130)", async () => {
    const config: RouterConfig = {
      profiles: {
        big: {
          high: {
            models: ["openai/gpt"],
            contextWindow: 200000,
            resolvedContextWindow: 200000,
          } as any,
          medium: {
            models: ["openai/mini"],
            contextWindow: 5000,
            resolvedContextWindow: 5000,
          } as any,
        },
      },
    };
    const reg = buildRegistry();
    state = {
      lastRegisteredModels: "",
      currentConfig: config,
      currentModelRegistry: reg,
      lastExtensionContext: {
        ui: { setHiddenThinkingLabel: vi.fn(), setWorkingMessage: vi.fn() },
      } as any,
      selectedProfile: undefined,
      routerEnabled: false,
      lastDecision: undefined,
      accumulatedCost: 0,
      failedByChain: new Map(),
    };
    actions = { persistState: vi.fn(), recordDebugDecision: vi.fn(), updateStatus: vi.fn() };
    registerRouterProvider(pi, state, actions);
    expect(opts.models[0].contextWindow).toBe(200000);
    // second registration with same modelsKey should early return (covers 158 return)
    const prevCallCount = pi.registerProvider.mock.calls.length;
    registerRouterProvider(pi, state, actions);
    expect(pi.registerProvider.mock.calls.length).toBe(prevCallCount); // no new registration
  });

  it("single tier skips classifier", async () => {
    const config: RouterConfig = {
      profiles: { single: { high: { models: ["openai/gpt"] } as any } },
      historySize: 0,
    };
    const reg = buildRegistry();
    state = {
      lastRegisteredModels: "",
      currentConfig: config,
      currentModelRegistry: reg,
      lastExtensionContext: {
        ui: { setHiddenThinkingLabel: vi.fn(), setWorkingMessage: vi.fn() },
      } as any,
      selectedProfile: undefined,
      routerEnabled: false,
      lastDecision: undefined,
      accumulatedCost: 0,
      failedByChain: new Map(),
    };
    actions = { persistState: vi.fn(), recordDebugDecision: vi.fn(), updateStatus: vi.fn() };
    registerRouterProvider(pi, state, actions);
    const stream = new MockStream();
    (createAssistantMessageEventStream as any).mockReturnValue(stream as any);
    const del = (async function* () {
      yield { type: "text_delta", delta: "hi" };
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })();
    streamSimple.mockReturnValue(del as any);
    const model = { id: "single", provider: "router", contextWindow: 100000 } as any;
    opts.streamSimple(model, { messages: [{ role: "user", content: "hi" }] } as any);
    await new Promise((r) => setTimeout(r, 80));
    expect(state.lastDecision?.tier).toBe("high");
  });

  it("tool loop preserves tier", async () => {
    const config: RouterConfig = {
      profiles: {
        balanced: { high: { models: ["openai/gpt"] }, medium: { models: ["openai/mini"] } } as any,
      },
    };
    const reg = buildRegistry();
    const prevDecision = {
      profile: "balanced",
      tier: "high",
      targetProvider: "openai",
      targetModelId: "gpt",
      targetLabel: "openai/gpt",
      thinking: "high",
      reasoning: "prev",
      timestamp: Date.now(),
    } as any;
    state = {
      lastRegisteredModels: "",
      currentConfig: config,
      currentModelRegistry: reg,
      lastExtensionContext: {
        ui: { setHiddenThinkingLabel: vi.fn(), setWorkingMessage: vi.fn() },
      } as any,
      selectedProfile: undefined,
      routerEnabled: false,
      lastDecision: prevDecision,
      accumulatedCost: 0,
      failedByChain: new Map(),
    };
    actions = { persistState: vi.fn(), recordDebugDecision: vi.fn(), updateStatus: vi.fn() };
    // thinking off but tool loop should skip classifier
    pi.getThinkingLevel.mockReturnValue("off");
    registerRouterProvider(pi, state, actions);
    const stream = new MockStream();
    (createAssistantMessageEventStream as any).mockReturnValue(stream as any);
    streamSimple.mockReturnValue(
      (async function* () {
        yield { type: "text_delta", delta: "a" };
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })() as any,
    );
    const model = { id: "balanced", provider: "router", contextWindow: 100000 } as any;
    const ctx: Context = {
      messages: [
        { role: "user", content: "hi", timestamp: 1 } as any,
        {
          role: "toolResult",
          toolCallId: "1",
          toolName: "t",
          content: "out",
          isError: false,
          timestamp: 2,
        } as any,
      ],
    } as any;
    opts.streamSimple(model, ctx);
    await new Promise((r) => setTimeout(r, 80));
    expect(state.lastDecision?.tier).toBe("high");
    expect(state.lastDecision?.reasoning).toContain("Preserved");
  });

  it("classifier success resolves with global classifier", async () => {
    const config: RouterConfig = {
      profiles: {
        balanced: {
          high: { models: ["openai/gpt-high"] } as any,
          medium: { models: ["openai/mini"] } as any,
        },
      },
      classifierModels: [{ model: "openai/gpt", thinking: "low" as any }],
      historySize: 0,
    } as RouterConfig;
    const reg = buildRegistry();
    // mock classifier stream to return tier
    const classifierStream = (async function* () {
      yield { type: "text_delta", delta: "high" };
    })();
    const delegateStream = (async function* () {
      yield { type: "text_delta", delta: "ans" };
      yield { type: "done", message: { usage: { cost: { total: 0.001 } } } };
    })();
    streamSimple
      .mockReturnValueOnce(classifierStream as any)
      .mockReturnValueOnce(delegateStream as any);
    state = {
      lastRegisteredModels: "",
      currentConfig: config,
      currentModelRegistry: reg,
      lastExtensionContext: {
        ui: { setHiddenThinkingLabel: vi.fn(), setWorkingMessage: vi.fn() },
      } as any,
      selectedProfile: undefined,
      routerEnabled: false,
      lastDecision: undefined,
      accumulatedCost: 0,
      failedByChain: new Map(),
    };
    actions = { persistState: vi.fn(), recordDebugDecision: vi.fn(), updateStatus: vi.fn() };
    pi.getThinkingLevel.mockReturnValue("off");
    registerRouterProvider(pi, state, actions);
    const stream = new MockStream();
    (createAssistantMessageEventStream as any).mockReturnValue(stream as any);
    opts.streamSimple(
      { id: "balanced", provider: "router", contextWindow: 100000 } as any,
      { messages: [{ role: "user", content: "hi" }] } as any,
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(state.lastDecision?.tier).toBe("high");
  });

  it("route failure memory all models failed", async () => {
    const config: RouterConfig = {
      profiles: { balanced: { medium: { models: ["openai/gpt", "openai/gpt2"] } as any } },
    };
    const reg = buildRegistry();
    state = {
      lastRegisteredModels: "",
      currentConfig: config,
      currentModelRegistry: reg,
      lastExtensionContext: {
        ui: { setHiddenThinkingLabel: vi.fn(), setWorkingMessage: vi.fn() },
      } as any,
      selectedProfile: undefined,
      routerEnabled: false,
      lastDecision: undefined,
      accumulatedCost: 0,
      failedByChain: new Map([["route:balanced:medium", new Set(["openai/gpt", "openai/gpt2"])]]),
    };
    actions = { persistState: vi.fn(), recordDebugDecision: vi.fn(), updateStatus: vi.fn() };
    pi.getThinkingLevel.mockReturnValue("medium");
    registerRouterProvider(pi, state, actions);
    const stream = new MockStream();
    (createAssistantMessageEventStream as any).mockReturnValue(stream as any);
    opts.streamSimple(
      { id: "balanced", provider: "router", contextWindow: 100000 } as any,
      { messages: [{ role: "user", content: "hi" }] } as any,
    );
    await new Promise((r) => setTimeout(r, 80));
    expect(
      stream.events.some(
        (e: any) => e.type === "error" && e.error.errorMessage.includes("All models"),
      ),
    ).toBe(true);
  });

  it("delegate with reasoning and stale ui ignored", async () => {
    const config: RouterConfig = {
      profiles: { balanced: { medium: { models: ["openai/gpt#high"] } as any } },
    };
    const reg = {
      find: vi.fn(
        () => ({ provider: "openai", id: "gpt", reasoning: true, contextWindow: 5000 }) as any,
      ),
      getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "k", headers: {} })),
      getProvider: () => ({ streamSimple }),
    } as any;
    state = {
      lastRegisteredModels: "",
      currentConfig: config,
      currentModelRegistry: reg,
      lastExtensionContext: {
        ui: {
          setHiddenThinkingLabel: vi.fn(() => {
            throw new Error("stale");
          }),
          setWorkingMessage: vi.fn(() => {
            throw new Error("stale");
          }),
        },
      } as any,
      selectedProfile: undefined,
      routerEnabled: false,
      lastDecision: undefined,
      accumulatedCost: 0,
      failedByChain: new Map(),
    };
    actions = {
      persistState: vi.fn(() => {
        throw new Error("stale persist");
      }),
      recordDebugDecision: vi.fn(),
      updateStatus: vi.fn(() => {
        throw new Error("stale");
      }),
    };
    pi.getThinkingLevel.mockReturnValue("medium");
    registerRouterProvider(pi, state, actions);
    const stream = new MockStream();
    (createAssistantMessageEventStream as any).mockReturnValue(stream as any);
    streamSimple.mockReturnValue(
      (async function* () {
        yield { type: "text_delta", delta: "a" };
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })() as any,
    );
    opts.streamSimple(
      { id: "balanced", provider: "router", contextWindow: 100000 } as any,
      { messages: [{ role: "user", content: "hi" }] } as any,
    );
    await new Promise((r) => setTimeout(r, 80));
    expect(stream.events.length).toBeGreaterThan(0);
  });

  it("handles router provider in modelsToTry skip", async () => {
    const config: RouterConfig = {
      profiles: { balanced: { medium: { models: ["router/other", "openai/gpt"] } as any } },
    };
    const reg = buildRegistry();
    state = {
      lastRegisteredModels: "",
      currentConfig: config,
      currentModelRegistry: reg,
      lastExtensionContext: {
        ui: { setHiddenThinkingLabel: vi.fn(), setWorkingMessage: vi.fn() },
      } as any,
      selectedProfile: undefined,
      routerEnabled: false,
      lastDecision: undefined,
      accumulatedCost: 0,
      failedByChain: new Map(),
    };
    actions = { persistState: vi.fn(), recordDebugDecision: vi.fn(), updateStatus: vi.fn() };
    pi.getThinkingLevel.mockReturnValue("medium");
    registerRouterProvider(pi, state, actions);
    const stream = new MockStream();
    (createAssistantMessageEventStream as any).mockReturnValue(stream as any);
    streamSimple.mockReturnValue(
      (async function* () {
        yield { type: "text_delta", delta: "a" };
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })() as any,
    );
    opts.streamSimple(
      { id: "balanced", provider: "router", contextWindow: 100000 } as any,
      { messages: [{ role: "user", content: "hi" }] } as any,
    );
    await new Promise((r) => setTimeout(r, 80));
    expect(state.lastDecision).toBeDefined();
  });

  it("handles contentReceivedForTry NON_RETRYABLE", async () => {
    const config: RouterConfig = {
      profiles: { balanced: { medium: { models: ["openai/gpt"] } as any } },
    };
    const reg = buildRegistry();
    state = {
      lastRegisteredModels: "",
      currentConfig: config,
      currentModelRegistry: reg,
      lastExtensionContext: { ui: { setHiddenThinkingLabel: vi.fn() } } as any,
      selectedProfile: undefined,
      routerEnabled: false,
      lastDecision: undefined,
      accumulatedCost: 0,
      failedByChain: new Map(),
    };
    actions = { persistState: vi.fn(), recordDebugDecision: vi.fn(), updateStatus: vi.fn() };
    pi.getThinkingLevel.mockReturnValue("medium");
    registerRouterProvider(pi, state, actions);
    const stream = new MockStream();
    (createAssistantMessageEventStream as any).mockReturnValue(stream as any);
    streamSimple.mockReturnValue(
      (async function* () {
        yield { type: "text_delta", delta: "part" };
        yield { type: "error", error: { errorMessage: "fail" } };
      })() as any,
    );
    opts.streamSimple(
      { id: "balanced", provider: "router", contextWindow: 100000 } as any,
      { messages: [{ role: "user", content: "hi" }] } as any,
    );
    await new Promise((r) => setTimeout(r, 80));
    expect(stream.events.some((e: any) => e.type === "error")).toBe(true);
  });

  it("handles aborted signal before delegation", async () => {
    const config: RouterConfig = {
      profiles: { balanced: { medium: { models: ["openai/gpt"] } as any } },
    };
    const reg = buildRegistry();
    state = {
      lastRegisteredModels: "",
      currentConfig: config,
      currentModelRegistry: reg,
      lastExtensionContext: { ui: { setHiddenThinkingLabel: vi.fn() } } as any,
      selectedProfile: undefined,
      routerEnabled: false,
      lastDecision: undefined,
      accumulatedCost: 0,
      failedByChain: new Map(),
    };
    actions = { persistState: vi.fn(), recordDebugDecision: vi.fn(), updateStatus: vi.fn() };
    pi.getThinkingLevel.mockReturnValue("medium");
    registerRouterProvider(pi, state, actions);
    const stream = new MockStream();
    (createAssistantMessageEventStream as any).mockReturnValue(stream as any);
    const controller = new AbortController();
    controller.abort();
    opts.streamSimple(
      { id: "balanced", provider: "router", contextWindow: 100000 } as any,
      { messages: [{ role: "user", content: "hi" }] } as any,
      { signal: controller.signal } as any,
    );
    await new Promise((r) => setTimeout(r, 80));
  });

  it("covers ?? branch for cost total undefined vs defined", async () => {
    const config: RouterConfig = {
      profiles: { balanced: { medium: { models: ["openai/gpt"] } as any } },
    };
    const reg = buildRegistry();
    state = {
      lastRegisteredModels: "",
      currentConfig: config,
      currentModelRegistry: reg,
      lastExtensionContext: { ui: { setHiddenThinkingLabel: vi.fn() } } as any,
      selectedProfile: undefined,
      routerEnabled: false,
      lastDecision: undefined,
      accumulatedCost: 0,
      failedByChain: new Map(),
    };
    actions = { persistState: vi.fn(), recordDebugDecision: vi.fn(), updateStatus: vi.fn() };
    pi.getThinkingLevel.mockReturnValue("medium");
    registerRouterProvider(pi, state, actions);
    // case with cost defined
    {
      const stream = new MockStream();
      (createAssistantMessageEventStream as any).mockReturnValue(stream as any);
      streamSimple.mockReturnValue(
        (async function* () {
          yield { type: "text_delta", delta: "a" };
          yield { type: "done", message: { usage: { cost: { total: 5 } } } };
        })() as any,
      );
      opts.streamSimple(
        { id: "balanced", provider: "router", contextWindow: 100000 } as any,
        { messages: [{ role: "user", content: "hi" }] } as any,
      );
      await new Promise((r) => setTimeout(r, 80));
      expect(state.accumulatedCost).toBe(5);
    }
    // case with cost undefined (should take ?? 0)
    {
      // reset accumulated
      state.accumulatedCost = 0;
      const stream2 = new MockStream();
      (createAssistantMessageEventStream as any).mockReturnValue(stream2 as any);
      streamSimple.mockReturnValue(
        (async function* () {
          yield { type: "text_delta", delta: "a" };
          yield { type: "done", message: {} as any };
        })() as any,
      );
      opts.streamSimple(
        { id: "balanced", provider: "router", contextWindow: 100000 } as any,
        { messages: [{ role: "user", content: "hi" }] } as any,
      );
      await new Promise((r) => setTimeout(r, 80));
      expect(state.accumulatedCost).toBe(0);
    }
  });
});
