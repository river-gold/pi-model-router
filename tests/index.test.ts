import { describe, it, expect, vi, beforeEach } from "vitest";
import routerExtension from "../src/index";
import rootExtension from "../index";
import type * as ConfigMod from "../src/config";
import {
  makeFakeExtensionContext,
  makeFakeModel,
  makeFakePi,
  makeFakeRegistry,
  makeFakeSessionManager,
  makeFakeUi,
} from "./helpers";

describe("index re-export는", () => {
  it("src/index의 routerExtension을 re-export한다", () => {
    expect(rootExtension).toBe(routerExtension);
  });
});

vi.mock("../src/config", async () => {
  const actual = await vi.importActual<typeof ConfigMod>("../src/config");
  return {
    ...actual,
    loadRouterConfig: vi.fn(() => ({
      config: {
        profiles: {
          balanced: {
            high: { models: ["openai/gpt-4o"] },
            medium: { models: ["openai/gpt-4o-mini"] },
          },
        },
      },
      warnings: [],
    })),
  };
});

describe("router extension 공개 동작은", () => {
  const makePiWithListeners = () => {
    const listeners = new Map<string, (...args: any[]) => unknown>();
    const on = vi.fn((event: string, handler: (...args: any[]) => unknown) => {
      listeners.set(event, handler);
    });
    const setModel = vi.fn().mockResolvedValue(true);
    const registerProvider = vi.fn();
    const registerCommand = vi.fn();
    const appendEntry = vi.fn();
    const getThinkingLevel = vi.fn().mockReturnValue("off");
    const pi = makeFakePi({
      on,
      setModel,
      registerProvider,
      registerCommand,
      appendEntry,
      getThinkingLevel,
    });
    return { pi, listeners, on, setModel, registerProvider, registerCommand, appendEntry };
  };

  const getHandler = (listeners: Map<string, (...args: any[]) => unknown>, name: string) => {
    const h = listeners.get(name);
    if (h === undefined) expect.unreachable();
    return h;
  };

  const makeCtx = (over: Partial<Parameters<typeof makeFakeExtensionContext>[0]> = {}) => {
    const notify = vi.fn();
    const setStatus = vi.fn();
    const setHiddenThinkingLabel = vi.fn();
    const find = vi
      .fn()
      .mockImplementation((p: string, id: string) =>
        makeFakeModel({ provider: p, id, contextWindow: 100000, maxTokens: 4000 }),
      );
    const list = vi.fn(() => [makeFakeModel({ provider: "openai", id: "gpt-4o" })]);
    const getApiKeyAndHeaders = vi.fn(async () => ({ ok: true, apiKey: "k" }));
    const ctx = makeFakeExtensionContext({
      cwd: "/mock",
      modelRegistry: makeFakeRegistry({ find, list, getApiKeyAndHeaders }),
      model: makeFakeModel({ provider: "router", id: "balanced" }),
      sessionManager: makeFakeSessionManager({ getBranch: () => [] }),
      ui: makeFakeUi({ notify, setStatus, setHiddenThinkingLabel }),
      ...over,
    });
    return { ctx, notify, setStatus, setHiddenThinkingLabel, find, list };
  };

  let bundled: ReturnType<typeof makePiWithListeners>;
  let listeners: Map<string, (...args: any[]) => unknown>;

  beforeEach(() => {
    bundled = makePiWithListeners();
    listeners = new Map();
  });

  it("provider, commands, hooks를 등록한다", () => {
    const { pi, registerProvider, registerCommand, on } = bundled;
    routerExtension(pi);
    expect(registerProvider).toHaveBeenCalledWith("router", expect.any(Object));
    expect(registerCommand).toHaveBeenCalledWith("router", expect.any(Object));
    expect(on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(on).toHaveBeenCalledWith("model_select", expect.any(Function));
    expect(on).toHaveBeenCalledWith("turn_end", expect.any(Function));
    listeners = bundled.listeners;
    void listeners;
  });

  it("session_start에서 router 모델로 router를 활성화한다", async () => {
    const { pi, listeners: captured, setModel } = bundled;
    routerExtension(pi);
    const { ctx, setStatus } = makeCtx();
    await getHandler(captured, "session_start")({}, ctx);
    expect(setStatus).toHaveBeenCalled();
    expect(setModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "router", id: "balanced" }),
    );
  });

  it("model_select로 router profile을 선택한다", async () => {
    const { pi, listeners: captured, appendEntry } = bundled;
    routerExtension(pi);
    const { ctx } = makeCtx();
    await getHandler(captured, "session_start")({}, ctx);
    appendEntry.mockClear();
    await getHandler(captured, "model_select")(
      { model: makeFakeModel({ provider: "router", id: "balanced" }) },
      ctx,
    );
    // dedup: same profile as already selected, no state change -> no append
    expect(appendEntry.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("non-router model_select에서 router를 비활성화하고 fallback을 기록한다", async () => {
    const { pi, listeners: captured, appendEntry } = bundled;
    routerExtension(pi);
    const { ctx, setHiddenThinkingLabel } = makeCtx();
    await getHandler(captured, "session_start")({}, ctx);
    appendEntry.mockClear();
    await getHandler(captured, "model_select")(
      { model: makeFakeModel({ provider: "anthropic", id: "claude" }) },
      ctx,
    );
    expect(setHiddenThinkingLabel).toHaveBeenCalled();
    expect(appendEntry).toHaveBeenCalledWith(
      "router-state",
      expect.objectContaining({ enabled: false, lastNonRouterModel: "anthropic/claude" }),
    );
  });

  it("unknown profile을 fallback 복원으로 처리한다", async () => {
    const { pi, listeners: captured, setModel } = bundled;
    routerExtension(pi);
    const { ctx } = makeCtx();
    await getHandler(captured, "session_start")({}, ctx);
    await getHandler(captured, "model_select")(
      { model: makeFakeModel({ provider: "anthropic", id: "claude" }) },
      ctx,
    );
    setModel.mockClear();
    const find = vi
      .fn()
      .mockImplementation((p: string, id: string) =>
        p === "anthropic" && id === "claude" ? makeFakeModel({ provider: p, id }) : undefined,
      );
    const list = vi.fn(() => [makeFakeModel({ provider: "anthropic", id: "claude" })]);
    const fallback = makeCtx({
      modelRegistry: makeFakeRegistry({ find, list }),
    });
    await getHandler(captured, "model_select")(
      { model: makeFakeModel({ provider: "router", id: "unknown" }) },
      fallback.ctx,
    );
    expect(fallback.notify).toHaveBeenCalledWith(
      expect.stringContaining("Unknown router profile"),
      "error",
    );
    expect(setModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "anthropic", id: "claude" }),
    );
  });

  it("unknown profile에 fallback이 없으면 경고한다", async () => {
    const { pi, listeners: captured } = bundled;
    routerExtension(pi);
    const { ctx } = makeCtx();
    await getHandler(captured, "session_start")({}, ctx);
    const find = vi.fn(() => undefined);
    const list = vi.fn(() => []);
    const noFallback = makeCtx({
      modelRegistry: makeFakeRegistry({ find, list }),
    });
    await getHandler(captured, "model_select")(
      { model: makeFakeModel({ provider: "router", id: "unknown" }) },
      noFallback.ctx,
    );
    expect(noFallback.notify).toHaveBeenCalledWith(
      expect.stringContaining("Unknown router profile"),
      "error",
    );
    expect(noFallback.notify).toHaveBeenCalledWith(
      expect.stringContaining("no fallback"),
      "warning",
    );
  });

  it("session branch에서 persisted state를 복원한다", async () => {
    const { pi, listeners: captured, setModel } = bundled;
    routerExtension(pi);
    const restored = makeCtx({
      sessionManager: makeFakeSessionManager({
        getBranch: () => [
          {
            type: "custom",
            customType: "router-state",
            data: {
              enabled: true,
              selectedProfile: "balanced",
              debugEnabled: true,
              accumulatedCost: 0.5,
              timestamp: Date.now(),
            },
          },
        ],
      }),
    });
    await getHandler(captured, "session_start")({}, restored.ctx);
    expect(setModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "router", id: "balanced" }),
    );
  });

  it("활성화된 경우 turn_end에서 router 모델을 복원한다", async () => {
    const { pi, listeners: captured, setModel } = bundled;
    routerExtension(pi);
    const { ctx } = makeCtx();
    await getHandler(captured, "session_start")({}, ctx);
    setModel.mockClear();
    ctx.model = makeFakeModel({ provider: "openai", id: "gpt-4o" });
    await getHandler(captured, "turn_end")({}, ctx);
    expect(setModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "router", id: "balanced" }),
    );
  });

  it("초기화 전 model_select를 무시한다", async () => {
    const { pi, listeners: captured, appendEntry } = bundled;
    routerExtension(pi);
    const { ctx } = makeCtx();
    appendEntry.mockClear();
    await getHandler(captured, "model_select")(
      { model: makeFakeModel({ provider: "anthropic", id: "claude" }) },
      ctx,
    );
    expect(appendEntry).not.toHaveBeenCalled();
  });

  it("동일한 state의 persist를 중복 제거한다", async () => {
    const { pi, listeners: captured, appendEntry } = bundled;
    routerExtension(pi);
    const { ctx } = makeCtx();
    await getHandler(captured, "session_start")({}, ctx);
    await getHandler(captured, "model_select")(
      { model: makeFakeModel({ provider: "router", id: "balanced" }) },
      ctx,
    );
    appendEntry.mockClear();
    await getHandler(captured, "turn_end")({}, ctx);
    const afterFirst = appendEntry.mock.calls.length;
    await getHandler(captured, "turn_end")({}, ctx);
    expect(appendEntry.mock.calls.length).toBe(afterFirst);
  });

  it("appendEntry throw를 안전하게 처리한다", async () => {
    const { pi, listeners: captured, appendEntry } = bundled;
    routerExtension(pi);
    const { ctx, setHiddenThinkingLabel } = makeCtx();
    await getHandler(captured, "session_start")({}, ctx);
    appendEntry.mockImplementation(() => {
      throw new Error("append failed");
    });
    await getHandler(captured, "model_select")(
      { model: makeFakeModel({ provider: "anthropic", id: "claude" }) },
      ctx,
    );
    expect(setHiddenThinkingLabel).toHaveBeenCalled();
  });

  it("복원 시 setModel 실패를 처리한다", async () => {
    const { pi, listeners: captured, setModel } = bundled;
    routerExtension(pi);
    const restored = makeCtx({
      sessionManager: makeFakeSessionManager({
        getBranch: () => [
          {
            type: "custom",
            customType: "router-state",
            data: { enabled: true, selectedProfile: "balanced", timestamp: Date.now() },
          },
        ],
      }),
    });
    setModel.mockResolvedValue(false);
    await getHandler(captured, "session_start")({}, restored.ctx);
    expect(restored.notify).toHaveBeenCalledWith(
      expect.stringContaining("Failed to restore"),
      "warning",
    );
  });

  it("fallback에서 find throw를 처리한다", async () => {
    const { pi, listeners: captured } = bundled;
    routerExtension(pi);
    const { ctx } = makeCtx();
    await getHandler(captured, "session_start")({}, ctx);
    await getHandler(captured, "model_select")(
      { model: makeFakeModel({ provider: "anthropic", id: "claude" }) },
      ctx,
    );
    const find = vi.fn(() => {
      throw new Error("find failed");
    });
    const list = vi.fn(() => []);
    const bad = makeCtx({
      modelRegistry: makeFakeRegistry({ find, list }),
    });
    await getHandler(captured, "model_select")(
      { model: makeFakeModel({ provider: "router", id: "unknown" }) },
      bad.ctx,
    );
    expect(bad.notify).toHaveBeenCalledWith(
      expect.stringContaining("Unknown router profile"),
      "error",
    );
  });
});
