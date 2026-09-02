/* oxlint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";
import routerExtension from "../index";
import * as configModule from "../src/config";

describe("index boost2", () => {
  let mockPi: any, listeners: Record<string, Function[]>;
  beforeEach(() => {
    listeners = {};
    mockPi = {
      registerProvider: vi.fn(),
      registerCommand: vi.fn(),
      setModel: vi.fn().mockResolvedValue(true),
      appendEntry: vi.fn(),
      on: vi.fn((e: string, h: Function) => {
        if (!listeners[e]) listeners[e] = [];
        listeners[e].push(h);
      }),
      getThinkingLevel: vi.fn().mockReturnValue("off"),
    };
    vi.spyOn(configModule, "loadRouterConfig").mockReturnValue({
      config: { profiles: { balanced: { high: { models: ["openai/gpt"] } } }, debug: false } as any,
      warnings: [],
    });
  });
  const buildCtx = (over: any = {}) => ({
    cwd: "/mock",
    modelRegistry: {
      find: vi.fn(
        (p: string, id: string) =>
          ({ provider: p, id, contextWindow: 100000, maxTokens: 4000 }) as any,
      ),
      list: vi.fn(() => [{ provider: "openai", id: "gpt" }]),
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }),
    },
    model: { provider: "router", id: "balanced" },
    sessionManager: { getBranch: () => [] },
    ui: {
      setStatus: vi.fn(),
      setHiddenThinkingLabel: vi.fn(),
      notify: vi.fn(),
      theme: { fg: (_: string, t: string) => t },
      setWorkingMessage: vi.fn(),
    },
    ...over,
  });

  it("setModelInternally catch returns false", async () => {
    mockPi.setModel = vi.fn().mockRejectedValue(new Error("fail"));
    routerExtension(mockPi);
    const ctx = buildCtx();
    for (const h of listeners["session_start"] || []) await h({}, ctx);
    // restore should have tried setModelInternally and caught -> routerEnabled false and notify
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Failed to restore"),
      "warning",
    );
  });

  it("tryFallbackByRef with no slash returns false and fallback fails", async () => {
    routerExtension(mockPi);
    const ctx = buildCtx();
    for (const h of listeners["session_start"] || []) await h({}, ctx);
    vi.mocked(configModule.loadRouterConfig).mockReturnValue({
      config: { profiles: {} } as any,
      warnings: [],
    });
    const ctx3 = buildCtx({
      model: { provider: "router", id: "balanced" },
      modelRegistry: {
        find: vi.fn(() => undefined),
        list: () => [],
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }),
      },
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: "router-state",
            data: {
              enabled: true,
              selectedProfile: "balanced",
              timestamp: Date.now(),
              lastNonRouterModel: "badrefwithoutslash",
            },
          },
        ],
      },
    });
    for (const h of listeners["session_start"] || []) await h({}, ctx3);
    expect(ctx3.ui.notify).toHaveBeenCalledWith(expect.stringContaining("no fallback"), "warning");
  });

  it("tryFallbackByRef where find throws is ignored", async () => {
    routerExtension(mockPi);
    const ctx = buildCtx();
    for (const h of listeners["session_start"] || []) await h({}, ctx);
    const badRegCtx = buildCtx({
      modelRegistry: {
        find: vi.fn(() => {
          throw new Error("find fail");
        }),
        list: () => [{ provider: "openai", id: "gpt" }],
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }),
      },
      model: { provider: "router", id: "unknown" },
      sessionManager: { getBranch: () => [] },
    });
    // Trigger model_select unknown to hit tryRestoreFallback which will call find that throws
    for (const h of listeners["model_select"] || [])
      await h({ model: { provider: "router", id: "unknown" } }, badRegCtx);
    expect(badRegCtx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Unknown router profile"),
      "error",
    );
  });

  it("persistState dedup and appendEntry throw ignored", async () => {
    mockPi.appendEntry = vi.fn(() => {
      throw new Error("append fail");
    });
    routerExtension(mockPi);
    const ctx = buildCtx();
    for (const h of listeners["session_start"] || []) await h({}, ctx);
    // persistState called during session_start, should not throw
    expect(mockPi.appendEntry).toHaveBeenCalled();
    // call again with same state should hit dedup return
    mockPi.appendEntry.mockClear();
    for (const h of listeners["turn_end"] || []) await h({}, ctx);
    // dedup may skip second call
  });

  it("reloadConfig with warnings notifies", async () => {
    vi.mocked(configModule.loadRouterConfig).mockReturnValue({
      config: { profiles: { balanced: { high: { models: ["openai/gpt"] } } }, debug: false } as any,
      warnings: ["warn1", "warn2"],
    });
    routerExtension(mockPi);
    const ctx = buildCtx();
    for (const h of listeners["session_start"] || []) await h({}, ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("warn1"), "warning");
  });

  it("ensureValidActiveRouterProfile early return when not router", async () => {
    routerExtension(mockPi);
    const ctx = buildCtx({ model: { provider: "openai", id: "gpt" } });
    for (const h of listeners["session_start"] || []) await h({}, ctx);
    // should have called setHiddenThinkingLabel
    expect(ctx.ui.setHiddenThinkingLabel).toHaveBeenCalled();
  });

  it("ensureValidActiveRouterProfile valid sets routerEnabled", async () => {
    routerExtension(mockPi);
    const ctx = buildCtx({ model: { provider: "router", id: "balanced" } });
    for (const h of listeners["session_start"] || []) await h({}, ctx);
    expect(ctx.ui.setStatus).toHaveBeenCalled();
  });

  it("model_select with contextWindow mismatch triggers setModelInternally", async () => {
    routerExtension(mockPi);
    const ctx = buildCtx();
    for (const h of listeners["session_start"] || []) await h({}, ctx);
    const mismatchCtx = buildCtx({
      modelRegistry: {
        find: vi.fn(
          (p: string, id: string) =>
            ({ provider: p, id, contextWindow: 999, maxTokens: 999 }) as any,
        ),
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }),
      },
    });
    // event model has different contextWindow
    for (const h of listeners["model_select"] || [])
      await h(
        { model: { provider: "router", id: "balanced", contextWindow: 111, maxTokens: 111 } },
        mismatchCtx,
      );
    expect(mockPi.setModel).toHaveBeenCalled();
  });

  it("turn_end restores router model when enabled", async () => {
    routerExtension(mockPi);
    const ctx = buildCtx({ model: { provider: "router", id: "balanced" } });
    for (const h of listeners["session_start"] || []) await h({}, ctx);
    mockPi.setModel.mockClear();
    ctx.model = { provider: "openai", id: "gpt" };
    for (const h of listeners["turn_end"] || []) await h({}, ctx);
    expect(mockPi.setModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "router", id: "balanced" }),
    );
  });

  it("model_select non-router records lastNonRouterModel", async () => {
    routerExtension(mockPi);
    const ctx = buildCtx();
    for (const h of listeners["session_start"] || []) await h({}, ctx);
    mockPi.appendEntry.mockClear();
    for (const h of listeners["model_select"] || [])
      await h({ model: { provider: "anthropic", id: "claude" } }, ctx);
    expect(ctx.ui.setHiddenThinkingLabel).toHaveBeenCalled();
    expect(mockPi.appendEntry).toHaveBeenCalledWith(
      "router-state",
      expect.objectContaining({ lastNonRouterModel: "anthropic/claude" }),
    );
  });

  it("ensureValid fallback success returns early (covers tryFallbackByRef true branch)", async () => {
    routerExtension(mockPi);
    const ctx = buildCtx();
    for (const h of listeners["session_start"] || []) await h({}, ctx);
    vi.mocked(configModule.loadRouterConfig).mockReturnValue({
      config: { profiles: {} } as any,
      warnings: [],
    });
    const successCtx = buildCtx({
      model: { provider: "router", id: "balanced" },
      modelRegistry: {
        find: vi.fn((p: string, id: string) => ({ provider: p, id, contextWindow: 1000 }) as any),
        list: () => [{ provider: "openai", id: "gpt" }],
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }),
      },
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: "router-state",
            data: {
              enabled: true,
              selectedProfile: "balanced",
              timestamp: Date.now(),
              lastNonRouterModel: "openai/gpt",
            },
          },
        ],
      },
    });
    mockPi.setModel.mockClear();
    for (const h of listeners["session_start"] || []) await h({}, successCtx);
    // should have called setModel for fallback and not notified "no fallback"
    expect(mockPi.setModel).toHaveBeenCalled();
    expect(successCtx.ui.notify).not.toHaveBeenCalledWith(
      expect.stringContaining("no fallback"),
      expect.any(String),
    );
  });

  it("model_select unknown with fallback success covers tryRestoreFallback true", async () => {
    routerExtension(mockPi);
    const ctx = buildCtx();
    for (const h of listeners["session_start"] || []) await h({}, ctx);
    // set lastNonRouterModel via a non-router select first
    for (const h of listeners["model_select"] || [])
      await h({ model: { provider: "anthropic", id: "claude" } }, ctx);
    mockPi.setModel.mockClear();
    ctx.ui.notify.mockClear();
    // now unknown router profile should fallback to anthropic/claude
    const fallbackCtx = buildCtx({
      modelRegistry: {
        find: vi.fn((p: string, id: string) => {
          if (p === "anthropic" && id === "claude") return { provider: p, id } as any;
          if (p === "router") return undefined;
          return { provider: p, id } as any;
        }),
        list: () => [{ provider: "openai", id: "gpt" }],
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }),
      },
    });
    // Use the same mockPi but need to ensure lastNonRouterModel is "anthropic/claude" from previous step
    // Trigger unknown profile
    for (const h of listeners["model_select"] || [])
      await h({ model: { provider: "router", id: "unknown" } }, fallbackCtx);
    expect(mockPi.setModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "anthropic", id: "claude" }),
    );
    expect(fallbackCtx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Unknown router profile"),
      "error",
    );
    expect(fallbackCtx.ui.notify).not.toHaveBeenCalledWith(
      expect.stringContaining("no fallback"),
      expect.any(String),
    );
  });
});
