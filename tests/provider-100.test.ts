/* oxlint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRunClassifierBranch = vi.fn();
const mockDelegateToTierModels = vi.fn();
const mockCreateStream = vi.fn();

vi.mock("@earendil-works/pi-ai", () => ({
  createAssistantMessageEventStream: (...args: unknown[]) => mockCreateStream(...args),
}));
vi.mock("../src/provider/classifierBranch", () => ({
  runClassifierBranch: (...args: unknown[]) => mockRunClassifierBranch(...args),
}));
vi.mock("../src/provider/delegate", () => ({
  delegateToTierModels: (...args: unknown[]) => mockDelegateToTierModels(...args),
}));

import { registerRouterProvider } from "../src/provider";
import type { Api, Model, Context } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterConfig } from "../src/types";

class S {
  events: unknown[] = [];
  push(e: unknown) { this.events.push(e); }
  end() {}
}

const makeReg = () => ({
  find: vi.fn((p: string, id: string) => ({ provider: p, id, input: ["text"], contextWindow: 50000, reasoning: true } as unknown)),
  getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "k", headers: {} })),
  getProvider: () => ({ streamSimple: vi.fn() }),
} as unknown as ExtensionContext["modelRegistry"]);

const ctx = (msgs: unknown[]) => ({ messages: msgs } as unknown as Context);
const mdl = (id: string, cw = 100000) => ({ id, provider: "router", api: "a" as Api, contextWindow: cw } as unknown as Model<Api>);
const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));

describe("provider 100% branches", () => {
  let pi: ExtensionAPI;
  let capturedStreamSimple: (m: Model<Api>, c: Context, o?: unknown) => unknown;
  let state: Parameters<typeof registerRouterProvider>[1];
  let acts: Parameters<typeof registerRouterProvider>[2];

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunClassifierBranch.mockReset();
    mockDelegateToTierModels.mockReset();
    mockCreateStream.mockReset();
    // default: delegate succeeds, classifier returns no result
    mockDelegateToTierModels.mockResolvedValue({ success: true, costDelta: 0 });
    mockRunClassifierBranch.mockResolvedValue({ result: undefined, attempts: [] });
    const cfg: RouterConfig = {
      profiles: {
        balanced: {
          high: { models: ["openai/gpt-4o"] } as unknown,
          medium: { models: ["openai/gpt-4o-mini"] } as unknown,
        },
      },
    };
    state = {
      lastRegisteredModels: "",
      currentConfig: cfg,
      currentModelRegistry: makeReg(),
      lastExtensionContext: { ui: { setHiddenThinkingLabel: vi.fn(), setWorkingMessage: vi.fn() } } as unknown as ExtensionContext,
      selectedProfile: undefined,
      routerEnabled: false,
      lastDecision: undefined,
      accumulatedCost: 0,
      failedByChain: new Map(),
    };
    acts = { persistState: vi.fn(), recordDebugDecision: vi.fn(), updateStatus: vi.fn() };
    pi = {
      registerProvider: vi.fn((_name: string, o: unknown) => { capturedStreamSimple = (o as { streamSimple: typeof capturedStreamSimple }).streamSimple; }),
      getThinkingLevel: vi.fn().mockReturnValue("medium"),
    } as unknown as ExtensionAPI;
  });

  it("94: registry undefined → error event Router provider not initialized", async () => {
    (pi.getThinkingLevel as unknown as ReturnType<typeof vi.fn>).mockReturnValue("medium");
    state.currentModelRegistry = undefined;
    registerRouterProvider(pi, state, acts);
    const s = new S();
    mockCreateStream.mockReturnValue(s as unknown as never);
    capturedStreamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    const err = s.events.find((e) => (e as { type: string }).type === "error") as { error: { errorMessage: string } } | undefined;
    expect(err).toBeDefined();
    expect(err!.error.errorMessage).toContain("Router provider not initialized");
  });

  it("95: unknown profile → error event Unknown router profile", async () => {
    registerRouterProvider(pi, state, acts);
    const s = new S();
    mockCreateStream.mockReturnValue(s as unknown as never);
    capturedStreamSimple(mdl("nonexistent"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    const err = s.events.find((e) => (e as { type: string }).type === "error") as { error: { errorMessage: string } } | undefined;
    expect(err).toBeDefined();
    expect(err!.error.errorMessage).toContain("Unknown router profile");
  });

  it("133: classifierResult truthy → decision replaced with classifier tier", async () => {
    (pi.getThinkingLevel as unknown as ReturnType<typeof vi.fn>).mockReturnValue("off");
    // profile with medium and low so classifier can resolve, plus global classifierModels to trigger branch
    state.currentConfig = {
      profiles: {
        balanced: {
          high: { models: ["openai/gpt-high"] } as unknown,
          medium: { models: ["openai/gpt-med"] } as unknown,
          low: { models: ["openai/gpt-low"] } as unknown,
        },
      },
      classifierModels: [{ model: "openai/gpt-classifier" } as unknown],
      historySize: 0,
    } as RouterConfig;
    state.lastRegisteredModels = "";
    mockRunClassifierBranch.mockResolvedValue({ result: { tier: "medium", reasoning: "test reason" }, attempts: [] });
    mockDelegateToTierModels.mockResolvedValue({ success: true, costDelta: 0 });
    registerRouterProvider(pi, state, acts);
    const s = new S();
    mockCreateStream.mockReturnValue(s as unknown as never);
    capturedStreamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    expect(state.lastDecision?.tier).toBe("medium");
    expect(state.lastDecision?.reasoning).toContain("Classifier: test reason");
    expect(state.lastDecision?.reasoning).not.toContain("Resolved from");
    expect(mockDelegateToTierModels).toHaveBeenCalled();
  });

  it("135: classifier tier !== preferred → reasoning includes Resolved from", async () => {
    (pi.getThinkingLevel as unknown as ReturnType<typeof vi.fn>).mockReturnValue("off");
    // need >1 tier so classifier runs; use low+medium so max not configured
    state.currentConfig = {
      profiles: {
        balanced: {
          medium: { models: ["openai/gpt-med"] } as unknown,
          low: { models: ["openai/gpt-low"] } as unknown,
        },
      },
      classifierModels: [{ model: "openai/gpt-classifier" } as unknown],
      historySize: 0,
    } as RouterConfig;
    state.lastRegisteredModels = "";
    mockRunClassifierBranch.mockResolvedValue({ result: { tier: "max", reasoning: "prefer max" }, attempts: [] });
    mockDelegateToTierModels.mockResolvedValue({ success: true, costDelta: 0 });
    registerRouterProvider(pi, state, acts);
    const s = new S();
    mockCreateStream.mockReturnValue(s as unknown as never);
    capturedStreamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    expect(state.lastDecision?.reasoning).toContain("Resolved from max to medium");
    expect(state.lastDecision?.tier).toBe("medium");
  });

  it("179: delegate success false with Error → throw Error instance", async () => {
    registerRouterProvider(pi, state, acts);
    mockDelegateToTierModels.mockResolvedValue({ success: false, lastError: new Error("upstream fail") });
    const s = new S();
    mockCreateStream.mockReturnValue(s as unknown as never);
    capturedStreamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    const err = s.events.find((e) => (e as { type: string }).type === "error") as { error: { errorMessage: string } } | undefined;
    expect(err).toBeDefined();
    expect(err!.error.errorMessage).toContain("upstream fail");
  });

  it("183: delegate success false with string → new Error(string)", async () => {
    registerRouterProvider(pi, state, acts);
    mockDelegateToTierModels.mockResolvedValue({ success: false, lastError: "string failure" });
    const s = new S();
    mockCreateStream.mockReturnValue(s as unknown as never);
    capturedStreamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    const err = s.events.find((e) => (e as { type: string }).type === "error") as { error: { errorMessage: string } } | undefined;
    expect(err).toBeDefined();
    expect(err!.error.errorMessage).toBe("string failure");
  });

  it("183 fallback: delegate success false with undefined → Failed to delegate message", async () => {
    registerRouterProvider(pi, state, acts);
    mockDelegateToTierModels.mockResolvedValue({ success: false, lastError: undefined });
    const s = new S();
    mockCreateStream.mockReturnValue(s as unknown as never);
    capturedStreamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    const err = s.events.find((e) => (e as { type: string }).type === "error") as { error: { errorMessage: string } } | undefined;
    expect(err).toBeDefined();
    expect(err!.error.errorMessage).toContain("Failed to delegate");
  });

  it("194: aborted signal → done with aborted message", async () => {
    registerRouterProvider(pi, state, acts);
    const s = new S();
    mockCreateStream.mockReturnValue(s as unknown as never);
    const controller = new AbortController();
    controller.abort();
    capturedStreamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]), { signal: controller.signal } as unknown);
    await wait();
    const done = s.events.find((e) => (e as { type: string }).type === "done") as { message: { errorMessage: string } } | undefined;
    expect(done).toBeDefined();
    expect(done!.message.errorMessage).toBe("aborted");
    expect(s.events.some((e) => (e as { type: string }).type === "error")).toBe(false);
  });

  it("211 stale branch: error includes stale → done with empty message", async () => {
    registerRouterProvider(pi, state, acts);
    // make delegate throw stale error
    mockDelegateToTierModels.mockRejectedValue(new Error("something stale context"));
    const s = new S();
    mockCreateStream.mockReturnValue(s as unknown as never);
    capturedStreamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    const done = s.events.find((e) => (e as { type: string }).type === "done") as { message: { errorMessage: string } } | undefined;
    expect(done).toBeDefined();
    expect(done!.message.errorMessage).toBe("");
    expect(s.events.some((e) => (e as { type: string }).type === "error")).toBe(false);
  });

  it("non-stale error → error event with message", async () => {
    registerRouterProvider(pi, state, acts);
    mockDelegateToTierModels.mockRejectedValue(new Error("normal failure"));
    const s = new S();
    mockCreateStream.mockReturnValue(s as unknown as never);
    capturedStreamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    const err = s.events.find((e) => (e as { type: string }).type === "error") as { error: { errorMessage: string } } | undefined;
    expect(err).toBeDefined();
    expect(err!.error.errorMessage).toContain("normal failure");
  });

  it("updateStatus throws stale → caught, still success", async () => {
    acts.updateStatus = vi.fn(() => { throw new Error("stale updateStatus"); });
    registerRouterProvider(pi, state, acts);
    mockDelegateToTierModels.mockResolvedValue({ success: true, costDelta: 0 });
    const s = new S();
    mockCreateStream.mockReturnValue(s as unknown as never);
    capturedStreamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    // should not produce error event, delegate still called
    expect(mockDelegateToTierModels).toHaveBeenCalled();
    expect(s.events.some((e) => (e as { type: string }).type === "error")).toBe(false);
  });

  it("persistState throws stale → caught in finally", async () => {
    acts.persistState = vi.fn(() => { throw new Error("stale persist"); });
    registerRouterProvider(pi, state, acts);
    mockDelegateToTierModels.mockResolvedValue({ success: true, costDelta: 0 });
    const s = new S();
    mockCreateStream.mockReturnValue(s as unknown as never);
    capturedStreamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    expect(acts.persistState).toHaveBeenCalled();
    // even when delegate succeeds, persistState stale is swallowed
    expect(s.events.some((e) => (e as { type: string }).type === "error")).toBe(false);
  });

  it("persistState throws stale after delegate failure → still error event", async () => {
    acts.persistState = vi.fn(() => { throw new Error("stale after error"); });
    registerRouterProvider(pi, state, acts);
    mockDelegateToTierModels.mockResolvedValue({ success: false, lastError: new Error("fail") });
    const s = new S();
    mockCreateStream.mockReturnValue(s as unknown as never);
    capturedStreamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    const err = s.events.find((e) => (e as { type: string }).type === "error") as { error: { errorMessage: string } } | undefined;
    expect(err).toBeDefined();
    expect(err!.error.errorMessage).toContain("fail");
  });

  it("non-Error thrown → error event with String(error)", async () => {
    registerRouterProvider(pi, state, acts);
    mockDelegateToTierModels.mockRejectedValue("plain string throw" as unknown as Error);
    const s = new S();
    mockCreateStream.mockReturnValue(s as unknown as never);
    capturedStreamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    const err = s.events.find((e) => (e as { type: string }).type === "error") as { error: { errorMessage: string } } | undefined;
    expect(err).toBeDefined();
    expect(err!.error.errorMessage).toBe("plain string throw");
  });

  it("179 false: classifier branch executed but returns undefined → no replacement", async () => {
    (pi.getThinkingLevel as unknown as ReturnType<typeof vi.fn>).mockReturnValue("off");
    state.currentConfig = {
      profiles: {
        balanced: {
          medium: { models: ["openai/gpt-med"] } as unknown,
          low: { models: ["openai/gpt-low"] } as unknown,
        },
      },
      classifierModels: [{ model: "openai/gpt-classifier" } as unknown],
      historySize: 0,
    } as RouterConfig;
    state.lastRegisteredModels = "";
    mockRunClassifierBranch.mockResolvedValue({ result: undefined, attempts: [] });
    mockDelegateToTierModels.mockResolvedValue({ success: true, costDelta: 0 });
    registerRouterProvider(pi, state, acts);
    const s = new S();
    mockCreateStream.mockReturnValue(s as unknown as never);
    capturedStreamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    // should remain default medium, not classifier replaced
    expect(state.lastDecision?.tier).toBe("medium");
    expect(state.lastDecision?.isClassifier).toBeFalsy();
  });

  it("94-95 true: registry returns large contextWindow triggers max update", async () => {
    // make registry return large window > DEFAULT_CONTEXT_WINDOW
    state.currentModelRegistry = {
      find: vi.fn(() => ({ provider: "openai", id: "big", contextWindow: 200000, maxTokens: 32000, reasoning: true } as unknown)),
      getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "k", headers: {} })),
      getProvider: () => ({ streamSimple: vi.fn() }),
    } as unknown as ExtensionContext["modelRegistry"];
    state.currentConfig = {
      profiles: {
        bigprofile: {
          high: { models: ["openai/big"] } as unknown,
        },
      },
    } as RouterConfig;
    state.lastRegisteredModels = "";
    registerRouterProvider(pi, state, acts);
    // verify registration used large window (no throw)
    expect((pi.registerProvider as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    // also trigger stream to ensure no error
    const s = new S();
    mockCreateStream.mockReturnValue(s as unknown as never);
    mockDelegateToTierModels.mockResolvedValue({ success: true, costDelta: 0 });
    capturedStreamSimple(mdl("bigprofile"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    expect(s.events.some((e) => (e as { type: string }).type === "error")).toBe(false);
  });

  it("194 falsy: lastExtensionContext undefined → updateStatus skipped", async () => {
    state.lastExtensionContext = undefined;
    registerRouterProvider(pi, state, acts);
    const s = new S();
    mockCreateStream.mockReturnValue(s as unknown as never);
    mockDelegateToTierModels.mockResolvedValue({ success: true, costDelta: 0 });
    capturedStreamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    expect(acts.updateStatus).not.toHaveBeenCalled();
    expect(s.events.some((e) => (e as { type: string }).type === "error")).toBe(false);
  });
});
