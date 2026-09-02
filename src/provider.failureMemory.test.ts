/* oxlint-disable */
import type { Api, AssistantMessageEventStream, Context, Model } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerRouterProvider } from "./provider";
import type { RouterConfig } from "./types";

vi.mock("@earendil-works/pi-ai", () => ({
  createAssistantMessageEventStream: vi.fn(),
}));

const streamSimple = vi.fn();

class MockEventStream {
  events: unknown[] = [];
  push(e: unknown) {
    this.events.push(e);
  }
  end() {}
}

describe("provider failure memory (session-scoped, chain-local)", () => {
  let mockPi: ExtensionAPI;
  let mockState: Record<string, unknown> & {
    failedByChain: Map<string, Set<string>>;
  };
  let mockActions: Record<string, unknown>;
  let registered: Record<string, unknown> & {
    streamSimple: (model: Model<Api>, ctx: Context) => void;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPi = {
      registerProvider: (
        _: string,
        opts: Record<string, unknown> & {
          streamSimple: (model: Model<Api>, ctx: Context) => void;
        },
      ) => {
        registered = opts;
      },
      getThinkingLevel: vi.fn().mockReturnValue("medium"),
    } as unknown as ExtensionAPI;
    const config: RouterConfig = {
      profiles: {
        balanced: {
          medium: {
            models: ["openai/gpt-4o-mini", "openai/gpt-4o"],
            resolvedContextWindow: 5000,
          },
          high: {
            models: ["openai/gpt-4o-mini", "openai/gpt-4o"],
            resolvedContextWindow: 5000,
          },
        },
      },
    };
    const mockRegistry = {
      find: (p: string, id: string) =>
        ({ provider: p, id, input: ["text"] }) as unknown as Model<Api>,
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }),
      getProvider: () => ({ streamSimple }),
    } as unknown as ExtensionContext["modelRegistry"];
    mockState = {
      lastRegisteredModels: "",
      currentConfig: config,
      currentModelRegistry: mockRegistry,
      lastExtensionContext: {
        ui: { setHiddenThinkingLabel: vi.fn(), setWorkingMessage: vi.fn() },
      } as unknown as ExtensionContext,
      selectedProfile: undefined,
      routerEnabled: false,
      lastDecision: undefined,
      accumulatedCost: 0,
      failedByChain: new Map<string, Set<string>>(),
    };
    mockActions = {
      persistState: vi.fn(),
      recordDebugDecision: vi.fn(),
      updateStatus: vi.fn(),
    };
  });

  it("skips failed model on next turn within same tier chain", async () => {
    registerRouterProvider(
      mockPi,
      mockState as unknown as Parameters<typeof registerRouterProvider>[1],
      mockActions as unknown as Parameters<typeof registerRouterProvider>[2],
    );
    const s1 = new MockEventStream();
    vi.mocked(createAssistantMessageEventStream).mockReturnValue(
      s1 as unknown as AssistantMessageEventStream,
    );
    // first turn: primary fails with recordable error, fallback succeeds
    let call = 0;
    vi.mocked(streamSimple).mockImplementation((m: Model<Api>) => {
      call++;
      if (m.id === "gpt-4o-mini") {
        return (async function* () {
          if (Math.random() < 0) yield undefined;
          throw new Error("429 rate limit exceeded");
        })() as unknown;
      }
      return (async function* () {
        yield { type: "text_delta", delta: "ok" };
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })() as unknown;
    });
    const model = {
      id: "balanced",
      api: "router-api" as Api,
      provider: "router",
    } as unknown as Model<Api>;
    const ctx = {
      messages: [{ role: "user", content: "hi" }],
    } as unknown as Context;
    registered.streamSimple(model, ctx);
    await new Promise((r) => setTimeout(r, 120));
    expect(mockState.failedByChain.get("route:balanced:medium")?.has("openai/gpt-4o-mini")).toBe(
      true,
    );

    // second turn: should skip gpt-4o-mini and directly try gpt-4o
    call = 0;
    const s2 = new MockEventStream();
    vi.mocked(createAssistantMessageEventStream).mockReturnValue(
      s2 as unknown as AssistantMessageEventStream,
    );
    vi.mocked(streamSimple).mockImplementation((m: Model<Api>) => {
      call++;
      expect(m.id).toBe("gpt-4o");
      return (async function* () {
        yield { type: "text_delta", delta: "ok2" };
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })() as unknown;
    });
    registered.streamSimple(model, ctx);
    await new Promise((r) => setTimeout(r, 120));
    expect(call).toBe(1);
    expect(
      s2.events.some(
        (e: unknown) =>
          (e as { type: string; delta: string }).type === "text_delta" &&
          (e as { type: string; delta: string }).delta === "ok2",
      ),
    ).toBe(true);
  });

  it("does not skip across different tier (chain-local)", async () => {
    registerRouterProvider(
      mockPi,
      mockState as unknown as Parameters<typeof registerRouterProvider>[1],
      mockActions as unknown as Parameters<typeof registerRouterProvider>[2],
    );
    mockState.failedByChain.set("route:balanced:medium", new Set(["openai/gpt-4o-mini"]));
    const s = new MockEventStream();
    vi.mocked(createAssistantMessageEventStream).mockReturnValue(
      s as unknown as AssistantMessageEventStream,
    );
    vi.mocked(mockPi.getThinkingLevel).mockReturnValue("high");
    const tried: string[] = [];
    vi.mocked(streamSimple).mockImplementation((m: Model<Api>) => {
      tried.push(m.id);
      return (async function* () {
        yield { type: "text_delta", delta: "ok" };
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })() as unknown;
    });
    const model = {
      id: "balanced",
      api: "router-api" as Api,
      provider: "router",
    } as unknown as Model<Api>;
    const ctx = {
      messages: [{ role: "user", content: "hi" }],
    } as unknown as Context;
    registered.streamSimple(model, ctx);
    await new Promise((r) => setTimeout(r, 120));
    expect(tried[0]).toBe("gpt-4o-mini");
  });

  it("does not record when content was received before error", async () => {
    registerRouterProvider(
      mockPi,
      mockState as unknown as Parameters<typeof registerRouterProvider>[1],
      mockActions as unknown as Parameters<typeof registerRouterProvider>[2],
    );
    const s = new MockEventStream();
    vi.mocked(createAssistantMessageEventStream).mockReturnValue(
      s as unknown as AssistantMessageEventStream,
    );
    vi.mocked(streamSimple).mockImplementation(() => {
      return (async function* () {
        yield { type: "text_delta", delta: "partial" };
        yield {
          type: "error",
          error: { errorMessage: "429 rate limit exceeded" },
        };
      })() as unknown;
    });
    const model = {
      id: "balanced",
      api: "router-api" as Api,
      provider: "router",
    } as unknown as Model<Api>;
    const ctx = {
      messages: [{ role: "user", content: "hi" }],
    } as unknown as Context;
    registered.streamSimple(model, ctx);
    await new Promise((r) => setTimeout(r, 120));
    expect(mockState.failedByChain.get("route:balanced:medium")).toBeUndefined();
    // should have pushed error with NON_RETRYABLE handling (no fallback)
    expect(s.events.some((e: unknown) => (e as { type: string }).type === "error")).toBe(true);
  });

  it("returns error when all models in tier are skipped (exhaustion)", async () => {
    registerRouterProvider(
      mockPi,
      mockState as unknown as Parameters<typeof registerRouterProvider>[1],
      mockActions as unknown as Parameters<typeof registerRouterProvider>[2],
    );
    mockState.failedByChain.set(
      "route:balanced:medium",
      new Set(["openai/gpt-4o-mini", "openai/gpt-4o"]),
    );
    const s = new MockEventStream();
    vi.mocked(createAssistantMessageEventStream).mockReturnValue(
      s as unknown as AssistantMessageEventStream,
    );
    const model = {
      id: "balanced",
      api: "router-api" as Api,
      provider: "router",
    } as unknown as Model<Api>;
    const ctx = {
      messages: [{ role: "user", content: "hi" }],
    } as unknown as Context;
    registered.streamSimple(model, ctx);
    await new Promise((r) => setTimeout(r, 120));
    const err = s.events.find(
      (e: unknown) => (e as { type: string }).type === "error",
    ) as unknown as { error: { errorMessage: string } };
    expect(err).toBeDefined();
    expect(err.error.errorMessage).toContain("All models in medium tier are marked failed");
    expect(err.error.errorMessage).toContain("/router reset-failures");
  });
});
