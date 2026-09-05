/* oxlint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { registerRouterProvider } from "../src/provider";
import { validateProviderState } from "../src/provider/validation";
import { decideInitialDecision } from "../src/provider/routing";
import {
  resolveTargetLimit,
  buildEffectiveContext,
  collectBufferedResult,
  isContentEvent,
} from "../src/provider/delegate";
import { createCommitMutex } from "../src/provider/state";
import { isRecordablePreStreamError } from "../src/failureMemory";
import type { Api, Model, Context } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterConfig } from "../src/types";

vi.mock("@earendil-works/pi-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-ai")>();
  return { ...actual, createAssistantMessageEventStream: vi.fn() };
});

const streamSimpleMock = vi.fn();
class S {
  events: unknown[] = [];
  push(e: unknown) {
    this.events.push(e);
  }
  end() {}
}
const makeReg = (findImpl?: (p: string, id: string) => unknown) =>
  ({
    find: vi.fn((p: string, id: string) =>
      findImpl
        ? findImpl(p, id)
        : ({ provider: p, id, input: ["text"], contextWindow: 50000, reasoning: true } as unknown),
    ),
    getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "k", headers: {} })),
    getProvider: () => ({ streamSimple: streamSimpleMock }),
  }) as unknown as ExtensionContext["modelRegistry"];
const ctx = (msgs: unknown[]) => ({ messages: msgs }) as unknown as Context;
const mdl = (id: string, cw = 100000) =>
  ({ id, provider: "router", api: "a" as Api, contextWindow: cw }) as unknown as Model<Api>;
const wait = (ms = 90) => new Promise((r) => setTimeout(r, ms));

describe("provider pure helpers", () => {
  it("validateProviderState throws for missing registry and profile", () => {
    expect(() =>
      validateProviderState(undefined, { medium: { models: ["openai/a"] } } as unknown, "balanced"),
    ).toThrow("not initialized");
    expect(() => validateProviderState(makeReg(), undefined, "unknown")).toThrow(
      "Unknown router profile",
    );
    expect(() =>
      validateProviderState(makeReg(), { medium: { models: ["openai/a"] } } as unknown, "balanced"),
    ).not.toThrow();
  });
  it("decideInitialDecision covers single tier, tool loop, thinking mapping", () => {
    const profile = { high: { models: ["openai/h"] } } as unknown;
    const base = {
      profileName: "p",
      profile,
      context: ctx([{ role: "user", content: "hi" }]),
      snapshotLastDecision: undefined,
      thinkingLevel: "high" as const,
      isToolLoop: false,
      singleTier: "high" as const,
      validTierCount: 1,
    };
    expect(decideInitialDecision(base).tier).toBe("high");
    const loopSnap = { profile: "p", tier: "high" } as unknown as never;
    expect(
      decideInitialDecision({ ...base, isToolLoop: true, snapshotLastDecision: loopSnap })
        .reasoning,
    ).toContain("Preserved");
    expect(
      decideInitialDecision({
        profileName: "p",
        profile: { medium: { models: ["openai/m"] } } as unknown,
        context: ctx([{ role: "user", content: "hi" }]),
        snapshotLastDecision: undefined,
        thinkingLevel: "off" as const,
        isToolLoop: false,
        singleTier: undefined,
        validTierCount: 1,
      }).tier,
    ).toBe("medium");
  });
  it("createCommitMutex serializes", async () => {
    const { withCommitMutex } = createCommitMutex();
    let v = 0;
    await withCommitMutex(async () => {
      v = 1;
    });
    await withCommitMutex(async () => {
      v = 2;
    });
    expect(v).toBe(2);
  });
  it("resolveTargetLimit finds tier and fallback", () => {
    const profile = { medium: { models: ["openai/a"] } } as unknown;
    const decision = {
      tier: "medium",
      targetProvider: "openai",
      targetModelId: "fallback",
    } as unknown as never;
    const reg = makeReg((_, id) =>
      id === "fallback" ? ({ contextWindow: 12345 } as unknown) : undefined,
    );
    expect(
      resolveTargetLimit(profile as unknown, decision, "openai/a", reg, "openai", "a"),
    ).toBeGreaterThan(0);
    expect(
      resolveTargetLimit({} as unknown, decision, "openai/fallback", reg, "openai", "fallback"),
    ).toBe(12345);
    const regNoWindow = makeReg(() => ({ provider: "openai", id: "x" }) as unknown);
    expect(
      resolveTargetLimit({} as unknown, decision, "openai/x", regNoWindow, "openai", "x"),
    ).toBeGreaterThan(0);
  });
  it("buildEffectiveContext truncates when needed", () => {
    const c = {
      messages: [
        { role: "user", content: "a".repeat(5000), timestamp: 1 },
        { role: "user", content: "b".repeat(5000), timestamp: 2 },
      ],
    } as unknown as Context;
    const truncated = buildEffectiveContext(c, 100, mdl("balanced", 100000));
    expect(truncated.messages.length).toBeLessThan(c.messages.length);
    const same = buildEffectiveContext(c, 500000, mdl("balanced", 1000));
    expect(same).toBe(c);
  });
  it("collectBufferedResult and isContentEvent", () => {
    expect(isContentEvent("text_delta")).toBe(true);
    expect(isContentEvent("done")).toBe(false);
    const r1 = collectBufferedResult([
      { type: "text_delta" },
      { type: "done", message: { usage: { cost: { total: 0.01 } } } },
    ]);
    expect(r1.gotDone).toBe(true);
    expect(r1.pendingCostDelta).toBe(0.01);
    expect(r1.contentReceived).toBe(true);
    const r2 = collectBufferedResult([{ type: "error", error: { errorMessage: "oops" } }]);
    expect(r2.gotError).toBe(true);
    expect(r2.bufferedErrorMessage).toBe("oops");
    const r3 = collectBufferedResult([{ type: "error", error: {} }]);
    expect(r3.bufferedErrorMessage).toBeUndefined();
    const r4 = collectBufferedResult([
      { type: "thinking_delta" },
      { type: "toolcall_delta" },
      { type: "toolcall_end" },
    ]);
    expect(r4.contentReceived).toBe(true);
  });
});

describe("provider integration", () => {
  let pi: ExtensionAPI;
  let state: Parameters<typeof registerRouterProvider>[1];
  let acts: Parameters<typeof registerRouterProvider>[2];
  let opts: { streamSimple: (m: Model<Api>, c: Context, o?: unknown) => unknown };
  beforeEach(() => {
    vi.clearAllMocks();
    streamSimpleMock.mockReset();
    pi = {
      registerProvider: vi.fn((_, o) => {
        opts = o as unknown as typeof opts;
      }),
      getThinkingLevel: vi.fn().mockReturnValue("medium"),
    } as unknown as ExtensionAPI;
    const cfg: RouterConfig = {
      profiles: {
        balanced: {
          high: { models: ["openai/gpt-4o"] } as unknown,
          medium: { models: ["openai/gpt-4o-mini", "google/gemini-1.5-flash"] } as unknown,
        },
      },
    };
    state = {
      lastRegisteredModels: "",
      currentConfig: cfg,
      currentModelRegistry: makeReg(),
      lastExtensionContext: {
        ui: { setHiddenThinkingLabel: vi.fn(), setWorkingMessage: vi.fn() },
      } as unknown as ExtensionContext,
      selectedProfile: undefined,
      routerEnabled: false,
      lastDecision: undefined,
      accumulatedCost: 0,
      failedByChain: new Map(),
    };
    acts = { persistState: vi.fn(), recordDebugDecision: vi.fn(), updateStatus: vi.fn() };
  });
  it("normal routing with thinking high", async () => {
    (pi.getThinkingLevel as unknown as ReturnType<typeof vi.fn>).mockReturnValue("high");
    registerRouterProvider(pi, state, acts);
    const s = new S();
    vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    streamSimpleMock.mockReturnValue(
      (async function* () {
        yield { type: "text_delta", delta: "ok" };
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })() as unknown,
    );
    opts.streamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    expect(state.lastDecision?.tier).toBe("high");
  });
  it("single tier and tool loop preserve", async () => {
    const prev = {
      profile: "balanced",
      tier: "high",
      targetProvider: "openai",
      targetModelId: "gpt",
      targetLabel: "openai/gpt",
      reasoning: "prev",
      timestamp: Date.now(),
    } as unknown as never;
    state.lastDecision = prev as unknown as never;
    (pi.getThinkingLevel as unknown as ReturnType<typeof vi.fn>).mockReturnValue("off");
    registerRouterProvider(pi, state, acts);
    const s = new S();
    vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    streamSimpleMock.mockReturnValue(
      (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })() as unknown,
    );
    opts.streamSimple(
      mdl("balanced"),
      ctx([
        { role: "user", content: "hi" },
        {
          role: "toolResult",
          toolCallId: "1",
          toolName: "t",
          content: "out",
          isError: false,
          timestamp: 2,
        } as unknown,
      ]),
    );
    await wait();
    expect(state.lastDecision?.tier).toBe("high");
  });
  it("registry undefined emits error", async () => {
    state.currentModelRegistry = undefined;
    registerRouterProvider(pi, state, acts);
    const s = new S();
    vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    opts.streamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    expect(s.events.some((e) => (e as { type: string }).type === "error")).toBe(true);
  });
  it("unknown profile emits error", async () => {
    registerRouterProvider(pi, state, acts);
    const s = new S();
    vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    opts.streamSimple(mdl("unknown"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    expect(s.events.some((e) => (e as { type: string }).type === "error")).toBe(true);
  });
  it("classifier off triggers branch and truncation", async () => {
    state.currentConfig = {
      profiles: {
        balanced: {
          high: { models: ["openai/gpt-high"] } as unknown,
          medium: { models: ["openai/mini"] } as unknown,
        },
      },
      classifierModels: [{ model: "openai/gpt" } as unknown],
      historySize: 0,
    } as RouterConfig;
    (pi.getThinkingLevel as unknown as ReturnType<typeof vi.fn>).mockReturnValue("off");
    registerRouterProvider(pi, state, acts);
    const s = new S();
    vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    streamSimpleMock
      .mockReturnValueOnce(
        (async function* () {
          yield { type: "text_delta", delta: "high" };
        })() as unknown,
      )
      .mockReturnValueOnce(
        (async function* () {
          yield { type: "text_delta", delta: "ans" };
          yield { type: "done", message: { usage: { cost: { total: 0.001 } } } };
        })() as unknown,
      );
    let passed: Context | null = null;
    const orig = streamSimpleMock.getMockImplementation();
    streamSimpleMock.mockImplementation((m: unknown, c: Context) => {
      if ((m as Model<Api>).id !== "gpt") passed = c;
      return (orig as unknown as (m: unknown, c: Context) => unknown)(m, c);
    });
    opts.streamSimple(mdl("balanced", 10000), {
      systemPrompt: "sys",
      messages: [
        { role: "user", content: "a".repeat(8000), timestamp: 1 } as unknown,
        { role: "user", content: "b".repeat(8000), timestamp: 2 } as unknown,
        { role: "user", content: "c".repeat(2000), timestamp: 3 } as unknown,
      ],
    } as unknown);
    await wait(150);
    expect(state.lastDecision).toBeDefined();
  });
  it("fallback retries and records cost", async () => {
    registerRouterProvider(pi, state, acts);
    const s = new S();
    vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    streamSimpleMock.mockImplementation((m: Model<Api>) =>
      m.id === "gpt-4o-mini"
        ? ((async function* () {
            yield { type: "error", error: { errorMessage: "fail" } };
          })() as unknown)
        : ((async function* () {
            yield { type: "done", message: { usage: { cost: { total: 0.0005 } } } };
          })() as unknown),
    );
    opts.streamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    expect(state.accumulatedCost).toBe(0.0005);
  });
  it("all failed via memory error", async () => {
    state.failedByChain.set(
      "route:balanced:medium",
      new Set(["openai/gpt-4o-mini", "google/gemini-1.5-flash"]),
    );
    registerRouterProvider(pi, state, acts);
    const s = new S();
    vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    opts.streamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    expect(s.events.some((e) => (e as { type: string }).type === "error")).toBe(true);
  });
  it("aborted signal done with aborted", async () => {
    registerRouterProvider(pi, state, acts);
    const s = new S();
    vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    const c = new AbortController();
    c.abort();
    opts.streamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]), {
      signal: c.signal,
    } as unknown);
    await wait();
    expect(s.events.some((e) => (e as { type: string }).type === "done")).toBe(true);
  });
  it("stale error maps to done empty", async () => {
    state.currentConfig = {
      profiles: { balanced: { medium: { models: ["openai/gpt"] } as unknown } },
    } as RouterConfig;
    state.lastRegisteredModels = "";
    registerRouterProvider(pi, state, acts);
    const s = new S();
    vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    streamSimpleMock.mockReturnValue(
      (async function* () {
        throw new Error("stale context");
      })() as unknown,
    );
    opts.streamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    expect(s.events.some((e) => (e as { type: string }).type === "done")).toBe(true);
    expect(s.events.some((e) => (e as { type: string }).type === "error")).toBe(false);
  });
  it("delegate success false maps to error via string and undefined fallback", async () => {
    // Use real delegate failure: make find return undefined for all models -> will throw All failed or record then fail
    state.currentModelRegistry = {
      find: () => undefined,
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }),
      getProvider: () => ({ streamSimple: streamSimpleMock }),
    } as unknown as ExtensionContext["modelRegistry"];
    state.currentConfig = {
      profiles: { balanced: { medium: { models: ["openai/missing"] } as unknown } },
    } as RouterConfig;
    state.lastRegisteredModels = "";
    registerRouterProvider(pi, state, acts);
    const s = new S();
    vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    opts.streamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    expect(s.events.some((e) => (e as { type: string }).type === "error")).toBe(true);
  });
  it("updateStatus stale and persistState stale are swallowed", async () => {
    acts.updateStatus = vi.fn(() => {
      throw new Error("stale update");
    });
    acts.persistState = vi.fn(() => {
      throw new Error("stale persist");
    });
    registerRouterProvider(pi, state, acts);
    const s = new S();
    vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    streamSimpleMock.mockReturnValue(
      (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })() as unknown,
    );
    opts.streamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    expect(s.events.some((e) => (e as { type: string }).type === "error")).toBe(false);
  });
  it("content then error is non-retryable", async () => {
    state.currentConfig = {
      profiles: { balanced: { medium: { models: ["openai/gpt"] } as unknown } },
    } as RouterConfig;
    state.lastRegisteredModels = "";
    registerRouterProvider(pi, state, acts);
    const s = new S();
    vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    streamSimpleMock.mockReturnValue(
      (async function* () {
        yield { type: "text_delta", delta: "part" };
        yield { type: "error", error: { errorMessage: "fail after content" } };
      })() as unknown,
    );
    opts.streamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    expect(s.events.some((e) => (e as { type: string }).type === "error")).toBe(true);
  });
  it("router ref skipped", async () => {
    state.currentConfig = {
      profiles: { balanced: { medium: { models: ["router/other", "openai/real"] } as unknown } },
    } as RouterConfig;
    state.lastRegisteredModels = "";
    registerRouterProvider(pi, state, acts);
    const s = new S();
    vi.mocked(createAssistantMessageEventStream).mockReturnValue(s as unknown as never);
    streamSimpleMock.mockReturnValue(
      (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })() as unknown,
    );
    opts.streamSimple(mdl("balanced"), ctx([{ role: "user", content: "hi" }]));
    await wait();
    expect(
      s.events.some(
        (e) =>
          (e as { type: string }).type === "done" || (e as { type: string }).type === "text_delta",
      ),
    ).toBe(true);
  });
});
