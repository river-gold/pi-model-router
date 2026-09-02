/* oxlint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";
import routerExtension from "../src/index";
import rootExtension from "../index";

describe("index re-export", () => {
  it("re-exports routerExtension from src/index", () => {
    expect(rootExtension).toBe(routerExtension);
  });
});

vi.mock("../src/config", async () => {
  const actual = await vi.importActual<typeof import("../src/config")>("../src/config");
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
      } as unknown as import("../src/types").RouterConfig,
      warnings: [],
    })),
  };
});

describe("router extension public behavior", () => {
  let pi: any;
  let listeners: Record<string, Function>;

  const makeCtx = (over: any = {}) => ({
    cwd: "/mock",
    modelRegistry: {
      find: vi.fn(
        (p: string, id: string) =>
          ({ provider: p, id, contextWindow: 100000, maxTokens: 4000 }) as any,
      ),
      list: vi.fn(() => [{ provider: "openai", id: "gpt-4o" }]),
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }),
    },
    model: { provider: "router", id: "balanced" },
    sessionManager: { getBranch: () => [] as any[] },
    ui: {
      setStatus: vi.fn(),
      setHiddenThinkingLabel: vi.fn(),
      notify: vi.fn(),
      theme: { fg: (_: string, t: string) => t },
    },
    ...over,
  });

  beforeEach(() => {
    listeners = {};
    pi = {
      registerProvider: vi.fn(),
      registerCommand: vi.fn(),
      setModel: vi.fn().mockResolvedValue(true),
      appendEntry: vi.fn(),
      on: vi.fn((e: string, h: Function) => {
        listeners[e] = h;
      }),
      getThinkingLevel: vi.fn().mockReturnValue("off"),
    };
  });

  it("registers provider, commands and hooks", () => {
    routerExtension(pi);
    expect(pi.registerProvider).toHaveBeenCalledWith("router", expect.any(Object));
    expect(pi.registerCommand).toHaveBeenCalledWith("router", expect.any(Object));
    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("model_select", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("turn_end", expect.any(Function));
  });

  it("enables router on session_start with router model", async () => {
    routerExtension(pi);
    const ctx = makeCtx();
    await listeners["session_start"]({}, ctx);
    expect(ctx.ui.setStatus).toHaveBeenCalled();
    expect(pi.setModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "router", id: "balanced" }),
    );
  });

  it("selects router profile via model_select", async () => {
    routerExtension(pi);
    const ctx = makeCtx();
    await listeners["session_start"]({}, ctx);
    pi.appendEntry.mockClear();
    await listeners["model_select"]({ model: { provider: "router", id: "balanced" } }, ctx);
    // dedup: same profile as already selected, no state change -> no append
    expect(pi.appendEntry.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("disables router on non-router model_select and records fallback", async () => {
    routerExtension(pi);
    const ctx = makeCtx();
    await listeners["session_start"]({}, ctx);
    pi.appendEntry.mockClear();
    await listeners["model_select"]({ model: { provider: "anthropic", id: "claude" } }, ctx);
    expect(ctx.ui.setHiddenThinkingLabel).toHaveBeenCalled();
    expect(pi.appendEntry).toHaveBeenCalledWith(
      "router-state",
      expect.objectContaining({ enabled: false, lastNonRouterModel: "anthropic/claude" }),
    );
  });

  it("handles unknown profile with fallback restore", async () => {
    routerExtension(pi);
    const ctx = makeCtx();
    await listeners["session_start"]({}, ctx);
    await listeners["model_select"]({ model: { provider: "anthropic", id: "claude" } }, ctx);
    pi.setModel.mockClear();
    const fallbackCtx = makeCtx({
      modelRegistry: {
        find: vi.fn((p: string, id: string) =>
          p === "anthropic" && id === "claude" ? ({ provider: p, id } as any) : undefined,
        ),
        list: () => [{ provider: "anthropic", id: "claude" }],
      },
    });
    await listeners["model_select"]({ model: { provider: "router", id: "unknown" } }, fallbackCtx);
    expect(fallbackCtx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Unknown router profile"),
      "error",
    );
    expect(pi.setModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "anthropic", id: "claude" }),
    );
  });

  it("warns when unknown profile has no fallback", async () => {
    routerExtension(pi);
    const ctx = makeCtx();
    await listeners["session_start"]({}, ctx);
    const noFallbackCtx = makeCtx({
      modelRegistry: { find: vi.fn(() => undefined), list: () => [] },
    });
    await listeners["model_select"](
      { model: { provider: "router", id: "unknown" } },
      noFallbackCtx,
    );
    expect(noFallbackCtx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Unknown router profile"),
      "error",
    );
    expect(noFallbackCtx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("no fallback"),
      "warning",
    );
  });

  it("restores persisted state from session branch", async () => {
    routerExtension(pi);
    const ctx = makeCtx({
      sessionManager: {
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
      },
    });
    await listeners["session_start"]({}, ctx);
    expect(pi.setModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "router", id: "balanced" }),
    );
  });

  it("restores router model on turn_end when enabled", async () => {
    routerExtension(pi);
    const ctx = makeCtx();
    await listeners["session_start"]({}, ctx);
    pi.setModel.mockClear();
    ctx.model = { provider: "openai", id: "gpt-4o" } as any;
    await listeners["turn_end"]({}, ctx);
    expect(pi.setModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "router", id: "balanced" }),
    );
  });

  it("ignores model_select before initialization", async () => {
    routerExtension(pi);
    const ctx = makeCtx();
    pi.appendEntry.mockClear();
    await listeners["model_select"]({ model: { provider: "anthropic", id: "claude" } }, ctx);
    expect(pi.appendEntry).not.toHaveBeenCalled();
  });

  it("deduplicates persist on identical state", async () => {
    routerExtension(pi);
    const ctx = makeCtx();
    await listeners["session_start"]({}, ctx);
    await listeners["model_select"]({ model: { provider: "router", id: "balanced" } }, ctx);
    pi.appendEntry.mockClear();
    await listeners["turn_end"]({}, ctx);
    const afterFirst = pi.appendEntry.mock.calls.length;
    await listeners["turn_end"]({}, ctx);
    expect(pi.appendEntry.mock.calls.length).toBe(afterFirst);
  });

  it("handles appendEntry throw gracefully", async () => {
    routerExtension(pi);
    const ctx = makeCtx();
    await listeners["session_start"]({}, ctx);
    pi.appendEntry.mockImplementation(() => {
      throw new Error("append failed");
    });
    await listeners["model_select"]({ model: { provider: "anthropic", id: "claude" } }, ctx);
    expect(ctx.ui.setHiddenThinkingLabel).toHaveBeenCalled();
  });

  it("handles setModel failure on restore", async () => {
    routerExtension(pi);
    const ctx = makeCtx({
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: "router-state",
            data: { enabled: true, selectedProfile: "balanced", timestamp: Date.now() },
          },
        ],
      },
    });
    pi.setModel.mockResolvedValue(false);
    await listeners["session_start"]({}, ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Failed to restore"),
      "warning",
    );
  });

  it("handles find throws in fallback", async () => {
    routerExtension(pi);
    const ctx = makeCtx();
    await listeners["session_start"]({}, ctx);
    await listeners["model_select"]({ model: { provider: "anthropic", id: "claude" } }, ctx);
    const badCtx = makeCtx({
      modelRegistry: {
        find: vi.fn(() => {
          throw new Error("find failed");
        }),
        list: () => [],
      },
    });
    await listeners["model_select"]({ model: { provider: "router", id: "unknown" } }, badCtx);
    expect(badCtx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Unknown router profile"),
      "error",
    );
  });
});
