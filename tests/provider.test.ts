import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as PiAi from "@earendil-works/pi-ai";
import type {
  AssistantMessageEvent,
  Context,
  Message,
  Model,
  Api,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
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
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RouterConfig, RouterProfile, RouterTier, RoutingDecision } from "../src/types";
import {
  makeFakeDecision,
  makeFakeExtensionContext,
  makeFakeModel,
  makeFakePi,
  makeFakeProvider,
  makeFakeProviderState,
  makeFakeRegistry,
  makeFakeUi,
} from "./helpers";

const { mockCreateStream } = vi.hoisted(() => ({ mockCreateStream: vi.fn() }));

vi.mock("@earendil-works/pi-ai", async () => {
  const actual = await vi.importActual<typeof PiAi>("@earendil-works/pi-ai");
  return { ...actual, createAssistantMessageEventStream: mockCreateStream };
});

type RouterProviderConfig = Parameters<ExtensionAPI["registerProvider"]>[1];

class FakeStream {
  events: AssistantMessageEvent[] = [];
  push(event: AssistantMessageEvent): void {
    this.events.push(event);
  }
  end(): void {}
}

const streamSimpleMock = vi.fn();

const makeReg = (findImpl?: (provider: string, modelId: string) => Model<Api> | undefined) =>
  makeFakeRegistry({
    find: vi.fn((provider: string, modelId: string) =>
      findImpl
        ? findImpl(provider, modelId)
        : makeFakeModel({ id: modelId, contextWindow: 50000, reasoning: true }),
    ),
    getApiKeyAndHeaders: vi.fn(async () => ({ ok: true as const, apiKey: "k", headers: {} })),
    getProvider: vi.fn(() => makeFakeProvider({ streamSimple: streamSimpleMock })),
  });

const userMsg = (content: string, timestamp = 1): UserMessage => ({
  role: "user",
  content,
  timestamp,
});

const toolResultMsg = (): ToolResultMessage => ({
  role: "toolResult",
  toolCallId: "1",
  toolName: "t",
  content: [{ type: "text", text: "out" }],
  isError: false,
  timestamp: 2,
});

const ctxOf = (messages: Message[]): Context => ({ messages });

const routerModel = (id: string, contextWindow = 100000): Model<Api> =>
  makeFakeModel({ id, contextWindow });

const isRouterProviderConfig = (value: unknown): value is RouterProviderConfig =>
  typeof value === "object" && value !== null && "streamSimple" in value;

const wait = (ms = 90) => new Promise((r) => setTimeout(r, ms));

describe("provider 순수 헬퍼는", () => {
  it("registry와 profile이 없으면 validateProviderState가 throw한다", () => {
    const profile: RouterProfile = { medium: { models: ["openai/a"] } };
    expect(() => validateProviderState(undefined, profile, "balanced")).toThrow("not initialized");
    expect(() => validateProviderState(makeReg(), undefined, "unknown")).toThrow(
      "Unknown router profile",
    );
    expect(() => validateProviderState(makeReg(), profile, "balanced")).not.toThrow();
  });
  it("decideInitialDecision은 single tier, tool loop, thinking 매핑을 처리한다", () => {
    const profile: RouterProfile = { high: { models: ["openai/h"] } };
    const base: {
      profileName: string;
      profile: RouterProfile;
      context: Context;
      snapshotLastDecision: RoutingDecision | undefined;
      thinkingLevel: ThinkingLevel;
      isToolLoop: boolean;
      singleTier: RouterTier | undefined;
      validTierCount: number;
    } = {
      profileName: "p",
      profile,
      context: ctxOf([userMsg("hi")]),
      snapshotLastDecision: undefined,
      thinkingLevel: "high",
      isToolLoop: false,
      singleTier: "high",
      validTierCount: 1,
    };
    expect(decideInitialDecision(base).tier).toBe("high");
    const loopSnap = makeFakeDecision({ profile: "p", tier: "high" });
    expect(
      decideInitialDecision({ ...base, isToolLoop: true, snapshotLastDecision: loopSnap })
        .reasoning,
    ).toContain("Preserved");
    expect(
      decideInitialDecision({
        profileName: "p",
        profile: { medium: { models: ["openai/m"] } },
        context: ctxOf([userMsg("hi")]),
        snapshotLastDecision: undefined,
        thinkingLevel: "off",
        isToolLoop: false,
        singleTier: undefined,
        validTierCount: 1,
      }).tier,
    ).toBe("medium");
  });
  it("createCommitMutex는 직렬화한다", async () => {
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
  it("resolveTargetLimit은 tier와 fallback을 찾는다", () => {
    const profile: RouterProfile = { medium: { models: ["openai/a"] } };
    const decision = makeFakeDecision({
      tier: "medium",
      targetProvider: "openai",
      targetModelId: "fallback",
    });
    const reg = makeReg((_provider, id) =>
      id === "fallback" ? makeFakeModel({ contextWindow: 12345 }) : undefined,
    );
    expect(resolveTargetLimit(profile, decision, "openai/a", reg, "openai", "a")).toBeGreaterThan(
      0,
    );
    const emptyProfile: RouterProfile = {};
    expect(
      resolveTargetLimit(emptyProfile, decision, "openai/fallback", reg, "openai", "fallback"),
    ).toBe(12345);
    const regNoWindow = makeReg(() => makeFakeModel({ id: "x" }));
    expect(
      resolveTargetLimit(emptyProfile, decision, "openai/x", regNoWindow, "openai", "x"),
    ).toBeGreaterThan(0);
  });
  it("buildEffectiveContext는 필요할 때 잘라낸다", () => {
    const c: Context = {
      messages: [userMsg("a".repeat(5000), 1), userMsg("b".repeat(5000), 2)],
    };
    const truncated = buildEffectiveContext(c, 100, routerModel("balanced", 100000));
    expect(truncated.messages.length).toBeLessThan(c.messages.length);
    const same = buildEffectiveContext(c, 500000, routerModel("balanced", 1000));
    expect(same).toBe(c);
  });
  it("collectBufferedResult와 isContentEvent를 처리한다", () => {
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

describe("provider 통합 동작은", () => {
  let pi: ExtensionAPI;
  let thinkingLevelMock = vi.fn((): ThinkingLevel => "medium");
  let state: Parameters<typeof registerRouterProvider>[1];
  let acts: Parameters<typeof registerRouterProvider>[2];
  let captured: RouterProviderConfig | undefined;
  const getStreamSimple = (): NonNullable<RouterProviderConfig["streamSimple"]> => {
    const fn = captured?.streamSimple;
    if (fn === undefined) expect.unreachable("router provider not registered");
    return fn;
  };
  beforeEach(() => {
    vi.clearAllMocks();
    streamSimpleMock.mockReset();
    mockCreateStream.mockReset();
    captured = undefined;
    thinkingLevelMock = vi.fn((): ThinkingLevel => "medium");
    pi = makeFakePi({
      registerProvider: vi.fn((...args: unknown[]) => {
        const config = args[1];
        if (isRouterProviderConfig(config)) captured = config;
      }),
      getThinkingLevel: thinkingLevelMock,
    });
    const cfg: RouterConfig = {
      profiles: {
        balanced: {
          high: { models: ["openai/gpt-4o"] },
          medium: { models: ["openai/gpt-4o-mini", "google/gemini-1.5-flash"] },
        },
      },
    };
    state = makeFakeProviderState({
      currentConfig: cfg,
      currentModelRegistry: makeReg(),
      lastExtensionContext: makeFakeExtensionContext({
        ui: makeFakeUi({ setHiddenThinkingLabel: vi.fn(), setWorkingMessage: vi.fn() }),
      }),
    });
    acts = { persistState: vi.fn(), recordDebugDecision: vi.fn(), updateStatus: vi.fn() };
  });
  it("thinking high로 정상 라우팅한다", async () => {
    thinkingLevelMock.mockReturnValue("high");
    registerRouterProvider(pi, state, acts);
    const s = new FakeStream();
    mockCreateStream.mockReturnValue(s);
    streamSimpleMock.mockReturnValue(
      (async function* () {
        yield { type: "text_delta", delta: "ok" };
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })(),
    );
    getStreamSimple()(routerModel("balanced"), ctxOf([userMsg("hi")]));
    await wait();
    expect(state.lastDecision?.tier).toBe("high");
  });
  it("single tier와 tool loop를 유지한다", async () => {
    state.lastDecision = makeFakeDecision({
      profile: "balanced",
      tier: "high",
      targetProvider: "openai",
      targetModelId: "gpt",
      targetLabel: "openai/gpt",
      reasoning: "prev",
      timestamp: Date.now(),
    });
    thinkingLevelMock.mockReturnValue("off");
    registerRouterProvider(pi, state, acts);
    const s = new FakeStream();
    mockCreateStream.mockReturnValue(s);
    streamSimpleMock.mockReturnValue(
      (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })(),
    );
    getStreamSimple()(routerModel("balanced"), ctxOf([userMsg("hi"), toolResultMsg()]));
    await wait();
    expect(state.lastDecision?.tier).toBe("high");
  });
  it("registry가 undefined이면 error를 발생시킨다", async () => {
    state = { ...state, currentModelRegistry: undefined };
    registerRouterProvider(pi, state, acts);
    const s = new FakeStream();
    mockCreateStream.mockReturnValue(s);
    getStreamSimple()(routerModel("balanced"), ctxOf([userMsg("hi")]));
    await wait();
    expect(s.events.some((e) => e.type === "error")).toBe(true);
  });
  it("unknown profile이면 error를 발생시킨다", async () => {
    registerRouterProvider(pi, state, acts);
    const s = new FakeStream();
    mockCreateStream.mockReturnValue(s);
    getStreamSimple()(routerModel("unknown"), ctxOf([userMsg("hi")]));
    await wait();
    expect(s.events.some((e) => e.type === "error")).toBe(true);
  });
  it("classifier off는 분기와 잘라내기를 실행한다", async () => {
    state = {
      ...state,
      currentConfig: {
        profiles: {
          balanced: {
            high: { models: ["openai/gpt-high"] },
            medium: { models: ["openai/mini"] },
          },
        },
        classifierModels: [{ model: "openai/gpt" }],
        historySize: 0,
      },
    };
    thinkingLevelMock.mockReturnValue("off");
    registerRouterProvider(pi, state, acts);
    const s = new FakeStream();
    mockCreateStream.mockReturnValue(s);
    streamSimpleMock
      .mockReturnValueOnce(
        (async function* () {
          yield { type: "text_delta", delta: "high" };
        })(),
      )
      .mockReturnValueOnce(
        (async function* () {
          yield { type: "text_delta", delta: "ans" };
          yield { type: "done", message: { usage: { cost: { total: 0.001 } } } };
        })(),
      );
    let _passed: Context | null = null;
    const orig = streamSimpleMock.getMockImplementation();
    streamSimpleMock.mockImplementation((model: Model<Api>, context: Context) => {
      if (model.id !== "gpt") _passed = context;
      return orig?.(model, context);
    });
    getStreamSimple()(routerModel("balanced", 10000), {
      systemPrompt: "sys",
      messages: [
        userMsg("a".repeat(8000), 1),
        userMsg("b".repeat(8000), 2),
        userMsg("c".repeat(2000), 3),
      ],
    });
    await wait(150);
    expect(state.lastDecision).toBeDefined();
  });
  it("fallback은 재시도하고 cost를 기록한다", async () => {
    registerRouterProvider(pi, state, acts);
    const s = new FakeStream();
    mockCreateStream.mockReturnValue(s);
    streamSimpleMock.mockImplementation((model: Model<Api>) =>
      model.id === "gpt-4o-mini"
        ? (async function* () {
            yield { type: "error", error: { errorMessage: "fail" } };
          })()
        : (async function* () {
            yield { type: "done", message: { usage: { cost: { total: 0.0005 } } } };
          })(),
    );
    getStreamSimple()(routerModel("balanced"), ctxOf([userMsg("hi")]));
    await wait();
    expect(state.accumulatedCost).toBe(0.0005);
  });
  it("모두 실패하면 memory error를 발생시킨다", async () => {
    state.failedByChain.set(
      "route:balanced:medium",
      new Set(["openai/gpt-4o-mini", "google/gemini-1.5-flash"]),
    );
    registerRouterProvider(pi, state, acts);
    const s = new FakeStream();
    mockCreateStream.mockReturnValue(s);
    getStreamSimple()(routerModel("balanced"), ctxOf([userMsg("hi")]));
    await wait();
    expect(s.events.some((e) => e.type === "error")).toBe(true);
  });
  it("aborted 시그널은 done과 aborted로 처리한다", async () => {
    registerRouterProvider(pi, state, acts);
    const s = new FakeStream();
    mockCreateStream.mockReturnValue(s);
    const c = new AbortController();
    c.abort();
    getStreamSimple()(routerModel("balanced"), ctxOf([userMsg("hi")]), {
      signal: c.signal,
    });
    await wait();
    expect(s.events.some((e) => e.type === "done")).toBe(true);
  });
  it("stale 에러는 빈 done으로 매핑된다", async () => {
    state = {
      ...state,
      currentConfig: {
        profiles: { balanced: { medium: { models: ["openai/gpt"] } } },
      },
      lastRegisteredModels: "",
    };
    registerRouterProvider(pi, state, acts);
    const s = new FakeStream();
    mockCreateStream.mockReturnValue(s);
    streamSimpleMock.mockReturnValue(
      (async function* () {
        yield* [];
        throw new Error("stale context");
      })(),
    );
    getStreamSimple()(routerModel("balanced"), ctxOf([userMsg("hi")]));
    await wait();
    expect(s.events.some((e) => e.type === "done")).toBe(true);
    expect(s.events.some((e) => e.type === "error")).toBe(false);
  });
  it("delegate success false는 string과 undefined fallback 경유로 error에 매핑된다", async () => {
    // Use real delegate failure: make find return undefined for all models -> will throw All failed or record then fail
    state = {
      ...state,
      currentModelRegistry: makeReg(() => undefined),
      currentConfig: {
        profiles: { balanced: { medium: { models: ["openai/missing"] } } },
      },
      lastRegisteredModels: "",
    };
    registerRouterProvider(pi, state, acts);
    const s = new FakeStream();
    mockCreateStream.mockReturnValue(s);
    getStreamSimple()(routerModel("balanced"), ctxOf([userMsg("hi")]));
    await wait();
    expect(s.events.some((e) => e.type === "error")).toBe(true);
  });
  it("stale updateStatus와 stale persistState는 무시된다", async () => {
    acts.updateStatus = vi.fn(() => {
      throw new Error("stale update");
    });
    acts.persistState = vi.fn(() => {
      throw new Error("stale persist");
    });
    registerRouterProvider(pi, state, acts);
    const s = new FakeStream();
    mockCreateStream.mockReturnValue(s);
    streamSimpleMock.mockReturnValue(
      (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })(),
    );
    getStreamSimple()(routerModel("balanced"), ctxOf([userMsg("hi")]));
    await wait();
    expect(s.events.some((e) => e.type === "error")).toBe(false);
  });
  it("content 이후 error는 non-retryable이다", async () => {
    state = {
      ...state,
      currentConfig: {
        profiles: { balanced: { medium: { models: ["openai/gpt"] } } },
      },
      lastRegisteredModels: "",
    };
    registerRouterProvider(pi, state, acts);
    const s = new FakeStream();
    mockCreateStream.mockReturnValue(s);
    streamSimpleMock.mockReturnValue(
      (async function* () {
        yield { type: "text_delta", delta: "part" };
        yield { type: "error", error: { errorMessage: "fail after content" } };
      })(),
    );
    getStreamSimple()(routerModel("balanced"), ctxOf([userMsg("hi")]));
    await wait();
    expect(s.events.some((e) => e.type === "error")).toBe(true);
  });
  it("router 참조는 skipped 처리된다", async () => {
    state = {
      ...state,
      currentConfig: {
        profiles: { balanced: { medium: { models: ["router/other", "openai/real"] } } },
      },
      lastRegisteredModels: "",
    };
    registerRouterProvider(pi, state, acts);
    const s = new FakeStream();
    mockCreateStream.mockReturnValue(s);
    streamSimpleMock.mockReturnValue(
      (async function* () {
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })(),
    );
    getStreamSimple()(routerModel("balanced"), ctxOf([userMsg("hi")]));
    await wait();
    expect(s.events.some((e) => e.type === "done" || e.type === "text_delta")).toBe(true);
  });
});
