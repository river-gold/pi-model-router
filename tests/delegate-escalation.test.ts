import { describe, it, expect, vi } from "vitest";
import { attemptSingleModel, delegateToTierModels } from "../src/provider/delegate";
vi.mock("../src/stream", () => ({
  streamDelegated: vi.fn(),
  modelWithAuthBaseUrl: (m: unknown) => m,
}));
import { streamDelegated } from "../src/stream";
describe("delegate escalation", () => {
  it("detects escalation toolcall", async () => {
    const stream = (async function* () {
      yield {
        type: "toolcall_end",
        toolCall: { name: "set_reasoning_effort", arguments: { level: "high" } },
      };
      yield { type: "done", message: { usage: { cost: { total: 0 } } } };
    })() as unknown as AsyncIterable<unknown>;
    vi.mocked(streamDelegated).mockReturnValue(stream as never);
    const params = {
      registry: {
        find: () => ({ provider: "openai", id: "a", reasoning: true }),
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }),
        getProvider: () => ({}),
      } as never,
      profile: { medium: { models: ["openai/a"] }, high: { models: ["openai/b"] } } as never,
      decision: {
        tier: "medium",
        targetProvider: "openai",
        targetModelId: "a",
        thinking: undefined,
        profile: "p",
      } as never,
      routerModel: { contextWindow: 100000 } as never,
      context: { messages: [{ role: "user", content: "hi" }] } as never,
      options: {},
      state: {
        failedByChain: new Map(),
        lastDecision: undefined,
        accumulatedCost: 0,
        lastExtensionContext: { ui: {} } as never,
      },
      withCommitMutex: async (fn: () => unknown) => fn(),
      stream: { push: vi.fn(), end: vi.fn() } as never,
      recordDebugDecision: vi.fn(),
    } as never;
    const res = await attemptSingleModel("openai/a", 0, params, () => {});
    expect(res.status).toBe("retry");
    expect((res as { error: { escalationTier?: string } }).error.escalationTier).toBe("high");
  });
  it("extractEscalation covers all branches", async () => {
    const { extractEscalation, stripEscalationTool, collectEscalation } =
      await import("../src/provider/delegate");
    const profile = { medium: { models: ["openai/a"] }, high: { models: ["openai/b"] } } as never;
    const decision = { tier: "medium" } as never;
    expect(extractEscalation({ type: "text_delta" }, profile, decision)).toBeUndefined();
    expect(extractEscalation({ type: "toolcall_end" }, profile, decision)).toBeUndefined();
    expect(
      extractEscalation({ type: "toolcall_end", toolCall: { name: "other" } }, profile, decision),
    ).toBeUndefined();
    expect(
      extractEscalation(
        {
          type: "toolcall_end",
          toolCall: { name: "set_reasoning_effort", arguments: { level: "invalid" } },
        },
        profile,
        decision,
      ),
    ).toBeUndefined();
    expect(
      extractEscalation(
        {
          type: "toolcall_end",
          toolCall: { name: "set_reasoning_effort", arguments: { level: "medium" } },
        },
        profile,
        decision,
      ),
    ).toBeUndefined();
    expect(
      extractEscalation(
        {
          type: "toolcall_end",
          toolCall: { name: "set_reasoning_effort", arguments: { level: "high" } },
        },
        profile,
        decision,
      ),
    ).toEqual({ tier: "high", reason: "" });
    expect(
      extractEscalation(
        {
          type: "toolcall_end",
          toolCall: { name: "set_reasoning_effort", arguments: { level: "high", reason: 123 } },
        },
        profile,
        decision,
      )?.reason,
    ).toBe("");
    expect(
      stripEscalationTool({
        messages: [],
        tools: [{ name: "set_reasoning_effort" }, { name: "other" }],
      } as never).tools?.length,
    ).toBe(1);
    expect(stripEscalationTool({ messages: [] } as never).tools?.length ?? 0).toBe(0);
    const c = new AbortController();
    c.abort();
    await expect(
      collectEscalation(
        (async function* () {
          yield { type: "text_delta" };
        })() as never,
        profile,
        decision,
        { signal: c.signal } as never,
        [],
        () => {},
      ),
    ).rejects.toThrow("aborted");
  });
  it("delegate retries on escalation", async () => {
    let call = 0;
    vi.mocked(streamDelegated).mockImplementation(() => {
      call++;
      if (call === 1)
        return (async function* () {
          yield {
            type: "toolcall_end",
            toolCall: { name: "set_reasoning_effort", arguments: { level: "high" } },
          };
          yield { type: "done", message: { usage: { cost: { total: 0 } } } };
        })() as unknown as never;
      return (async function* () {
        yield { type: "text_delta", delta: "hi" };
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })() as unknown as never;
    });
    const p = { medium: { models: ["openai/a"] }, high: { models: ["openai/b"] } } as never;
    const d = {
      tier: "medium",
      profile: "p",
      targetProvider: "openai",
      targetModelId: "a",
    } as never;
    const params2 = {
      registry: {
        find: () => ({ provider: "openai", id: "a", reasoning: true }),
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }),
      } as never,
      profile: p,
      decision: d,
      routerModel: { contextWindow: 100000 } as never,
      context: {
        messages: [{ role: "user", content: "hi" }],
        tools: [{ name: "set_reasoning_effort" }],
      } as never,
      options: {},
      state: {
        failedByChain: new Map(),
        lastDecision: undefined,
        accumulatedCost: 0,
        lastExtensionContext: { ui: { notify: vi.fn() } } as never,
      },
      withCommitMutex: async (fn: () => unknown) => fn(),
      stream: { push: vi.fn(), end: vi.fn() } as never,
      recordDebugDecision: vi.fn(),
    } as never;
    const res = await delegateToTierModels(params2);
    expect(res.success).toBe(true);
  });
  it("same tier escalation no retry", async () => {
    vi.mocked(streamDelegated).mockReturnValue(
      (async function* () {
        yield {
          type: "toolcall_end",
          toolCall: { name: "set_reasoning_effort", arguments: { level: "medium" } },
        };
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })() as unknown as never,
    );
    const p = { medium: { models: ["openai/a"] } } as never;
    const d = {
      tier: "medium",
      profile: "p",
      targetProvider: "openai",
      targetModelId: "a",
    } as never;
    const params2 = {
      registry: {
        find: () => ({ provider: "openai", id: "a", reasoning: true }),
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }),
      } as never,
      profile: p,
      decision: d,
      routerModel: { contextWindow: 100000 } as never,
      context: { messages: [{ role: "user", content: "hi" }] } as never,
      options: {},
      state: {
        failedByChain: new Map(),
        lastDecision: undefined,
        accumulatedCost: 0,
        lastExtensionContext: { ui: {} } as never,
      },
      withCommitMutex: async (fn: () => unknown) => fn(),
      stream: { push: vi.fn(), end: vi.fn() } as never,
      recordDebugDecision: vi.fn(),
    } as never;
    const res = await delegateToTierModels(params2);
    expect(res.success).toBe(true);
  });
  it("invalid escalation level ignored", async () => {
    vi.mocked(streamDelegated).mockReturnValue(
      (async function* () {
        yield {
          type: "toolcall_end",
          toolCall: { name: "set_reasoning_effort", arguments: { level: "invalid" } },
        };
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })() as unknown as never,
    );
    const p = { medium: { models: ["openai/a"] } } as never;
    const d = {
      tier: "medium",
      profile: "p",
      targetProvider: "openai",
      targetModelId: "a",
    } as never;
    const params2 = {
      registry: {
        find: () => ({ provider: "openai", id: "a", reasoning: true }),
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }),
      } as never,
      profile: p,
      decision: d,
      routerModel: { contextWindow: 100000 } as never,
      context: { messages: [{ role: "user", content: "hi" }] } as never,
      options: {},
      state: {
        failedByChain: new Map(),
        lastDecision: undefined,
        accumulatedCost: 0,
        lastExtensionContext: { ui: {} } as never,
      },
      withCommitMutex: async (fn: () => unknown) => fn(),
      stream: { push: vi.fn(), end: vi.fn() } as never,
      recordDebugDecision: vi.fn(),
    } as never;
    const res = await attemptSingleModel("openai/a", 0, params2, () => {});
    expect(res.status).toBe("success");
  });
  it("toolcall_end without toolCall ignored", async () => {
    vi.mocked(streamDelegated).mockReturnValue(
      (async function* () {
        yield { type: "toolcall_end" };
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })() as unknown as never,
    );
    const p = { medium: { models: ["openai/a"] } } as never;
    const d = {
      tier: "medium",
      profile: "p",
      targetProvider: "openai",
      targetModelId: "a",
    } as never;
    const params2 = {
      registry: {
        find: () => ({ provider: "openai", id: "a", reasoning: true }),
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }),
      } as never,
      profile: p,
      decision: d,
      routerModel: { contextWindow: 100000 } as never,
      context: { messages: [{ role: "user", content: "hi" }] } as never,
      options: {},
      state: {
        failedByChain: new Map(),
        lastDecision: undefined,
        accumulatedCost: 0,
        lastExtensionContext: { ui: {} } as never,
      },
      withCommitMutex: async (fn: () => unknown) => fn(),
      stream: { push: vi.fn(), end: vi.fn() } as never,
      recordDebugDecision: vi.fn(),
    } as never;
    const res = await attemptSingleModel("openai/a", 0, params2, () => {});
    expect(res.status).toBe("success");
  });
  it("escalation then failure", async () => {
    let c = 0;
    vi.mocked(streamDelegated).mockImplementation(() => {
      c++;
      if (c === 1)
        return (async function* () {
          yield {
            type: "toolcall_end",
            toolCall: { name: "set_reasoning_effort", arguments: { level: "high" } },
          };
          yield { type: "done", message: { usage: { cost: { total: 0 } } } };
        })() as unknown as never;
      return (async function* () {
        yield { type: "error", error: { errorMessage: "fail" } };
      })() as unknown as never;
    });
    const p = { medium: { models: ["openai/a"] }, high: { models: ["openai/b"] } } as never;
    const d = {
      tier: "medium",
      profile: "p",
      targetProvider: "openai",
      targetModelId: "a",
    } as never;
    const params2 = {
      registry: {
        find: () => ({ provider: "openai", id: "a", reasoning: true }),
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }),
      } as never,
      profile: p,
      decision: d,
      routerModel: { contextWindow: 100000 } as never,
      context: {
        messages: [{ role: "user", content: "hi" }],
        tools: [{ name: "set_reasoning_effort" }],
      } as never,
      options: {},
      state: {
        failedByChain: new Map(),
        lastDecision: undefined,
        accumulatedCost: 0,
        lastExtensionContext: { ui: { notify: vi.fn() } } as never,
      },
      withCommitMutex: async (fn: () => unknown) => fn(),
      stream: { push: vi.fn(), end: vi.fn() } as never,
      recordDebugDecision: vi.fn(),
    } as never;
    const res = await delegateToTierModels(params2);
    expect(res.success).toBe(false);
  });
  it("non-escalation toolcall ignored", async () => {
    vi.mocked(streamDelegated).mockReturnValue(
      (async function* () {
        yield {
          type: "toolcall_end",
          toolCall: { name: "other_tool", arguments: { level: "high" } },
        };
        yield { type: "done", message: { usage: { cost: { total: 0 } } } };
      })() as unknown as never,
    );
    const p = { medium: { models: ["openai/a"] } } as never;
    const d = {
      tier: "medium",
      profile: "p",
      targetProvider: "openai",
      targetModelId: "a",
    } as never;
    const params2 = {
      registry: {
        find: () => ({ provider: "openai", id: "a", reasoning: true }),
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }),
      } as never,
      profile: p,
      decision: d,
      routerModel: { contextWindow: 100000 } as never,
      context: { messages: [{ role: "user", content: "hi" }] } as never,
      options: {},
      state: {
        failedByChain: new Map(),
        lastDecision: undefined,
        accumulatedCost: 0,
        lastExtensionContext: { ui: {} } as never,
      },
      withCommitMutex: async (fn: () => unknown) => fn(),
      stream: { push: vi.fn(), end: vi.fn() } as never,
      recordDebugDecision: vi.fn(),
    } as never;
    const res = await attemptSingleModel("openai/a", 0, params2, () => {});
    expect(res.status).toBe("success");
  });
  it("covers remaining branches", async () => {
    const { resolveTargetLimit, collectBufferedResult } = await import("../src/provider/delegate");
    // line 117: found undefined
    const profile = {} as never;
    const decision = { tier: "medium", targetProvider: "x", targetModelId: "y" } as never;
    const reg = { find: () => undefined } as never;
    expect(resolveTargetLimit(profile, decision, "x/y", reg, "x", "y")).toBeDefined();
    // line 123: isContentEvent false
    const r = collectBufferedResult([
      { type: "done", message: { usage: { cost: { total: 0 } } } },
      { type: "error", error: {} },
    ]);
    expect(r.gotDone).toBe(true);
  });

  it("covers remaining branches", async () => {
    const { resolveTargetLimit, collectBufferedResult } = await import("../src/provider/delegate");
    // line 117: found undefined
    const profile = {} as never;
    const decision = { tier: "medium", targetProvider: "x", targetModelId: "y" } as never;
    const reg = { find: () => undefined } as never;
    expect(resolveTargetLimit(profile, decision, "x/y", reg, "x", "y")).toBeDefined();
    // line 123: isContentEvent false
    const r = collectBufferedResult([
      { type: "done", message: { usage: { cost: { total: 0 } } } },
      { type: "error", error: {} },
    ]);
    expect(r.gotDone).toBe(true);
  });

  it("resolveTargetLimit no contextWindow", async () => {
    const { resolveTargetLimit } = await import("../src/provider/delegate");
    const profile = {} as never;
    const decision = { tier: "medium", targetProvider: "x", targetModelId: "y" } as never;
    const reg = { find: () => ({ provider: "x", id: "y" }) } as never; // no contextWindow
    expect(resolveTargetLimit(profile, decision, "x/y", reg, "x", "y")).toBeDefined();
  });
  it("escalation without reason", async () => {
    const { extractEscalation } = await import("../src/provider/delegate");
    const profile = { medium: { models: ["openai/a"] }, high: { models: ["openai/b"] } } as never;
    const decision = { tier: "medium" } as never;
    // reason undefined -> ?? "" branch
    expect(
      extractEscalation(
        {
          type: "toolcall_end",
          toolCall: { name: "set_reasoning_effort", arguments: { level: "high" } },
        },
        profile,
        decision,
      )?.reason,
    ).toBe("");
  });
});
