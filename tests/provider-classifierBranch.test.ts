import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Context } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterProfile } from "../src/types";
import { CLASSIFIER_CHAIN_KEY } from "../src/failureMemory";

const { mockResolveEffectiveClassifier, mockRunClassifierWithFallbacksDetailed } = vi.hoisted(() => ({
  mockResolveEffectiveClassifier: vi.fn(),
  mockRunClassifierWithFallbacksDetailed: vi.fn(),
}));

vi.mock("../src/config", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return { ...orig, resolveEffectiveClassifier: mockResolveEffectiveClassifier };
});
vi.mock("../src/classifier", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return { ...orig, runClassifierWithFallbacksDetailed: mockRunClassifierWithFallbacksDetailed };
});

import { runClassifierBranch } from "../src/provider/classifierBranch";

const makeRegistry = () =>
  ({
    find: vi.fn(),
    getApiKeyAndHeaders: vi.fn(),
    getProvider: vi.fn(),
  }) as unknown as ExtensionContext["modelRegistry"];

const makeState = (over?: Partial<{
  lastExtensionContext: ExtensionContext | undefined;
  failedByChain: Map<string, Set<string>>;
  currentConfig: { classifierModels?: import("../src/types").ClassifierConfig[]; historySize?: number };
}>) => ({
  currentConfig: { classifierModels: [{ model: "openai/gpt" } as unknown], historySize: 0, ...over?.currentConfig },
  failedByChain: over?.failedByChain ?? new Map<string, Set<string>>(),
  lastExtensionContext: over?.lastExtensionContext ?? ({
    ui: { setWorkingMessage: vi.fn() },
  } as unknown as ExtensionContext),
});

const ctx = { messages: [{ role: "user", content: "hi", timestamp: 1 }] } as unknown as Context;
const profile = { medium: { models: ["openai/gpt"] } } as unknown as RouterProfile;

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveEffectiveClassifier.mockReturnValue({
    classifiers: [{ model: "openai/gpt", thinking: "high", source: "profile" }],
    source: "profile",
  });
});

describe("runClassifierBranch", () => {
  it("given no effective classifiers then throws", async () => {
    mockResolveEffectiveClassifier.mockReturnValue({ classifiers: undefined, source: "none" });
    const state = makeState();
    await expect(
      runClassifierBranch(makeRegistry(), profile, state, ctx, undefined, 0, new Set<string>(), "profile"),
    ).rejects.toThrow("No classifier available");
  });

  it("given aborted signal then throws", async () => {
    const state = makeState();
    const signal = { aborted: true } as unknown as AbortSignal;
    await expect(
      runClassifierBranch(makeRegistry(), profile, state, ctx, signal, 0, new Set<string>(), "profile"),
    ).rejects.toThrow("aborted");
  });

  it("given undefined signal then does not throw aborted", async () => {
    const state = makeState();
    mockRunClassifierWithFallbacksDetailed.mockImplementation(async (_a: unknown, _b: unknown, _c: unknown, _d: unknown, _e: unknown, onAttempt: (entry: { model: string; thinking?: string; source?: string }) => void) => {
      onAttempt({ model: "openai/gpt", source: "profile", thinking: "high" });
      return { result: { tier: "high", reasoning: "ok" }, attempts: [] };
    });
    const res = await runClassifierBranch(makeRegistry(), profile, state, ctx, undefined, 0, new Set<string>(), "fallback");
    expect(res.result?.tier).toBe("high");
  });

  it("given non-aborted signal then proceeds", async () => {
    const state = makeState();
    const signal = { aborted: false } as unknown as AbortSignal;
    mockRunClassifierWithFallbacksDetailed.mockResolvedValue({ result: { tier: "low", reasoning: "r" }, attempts: [] });
    const res = await runClassifierBranch(makeRegistry(), profile, state, ctx, signal, 0, new Set<string>(), "profile");
    expect(res.result?.tier).toBe("low");
  });

  it("given onAttempt with source and thinking then formats message and handles stale catch", async () => {
    const setWorkingMessage = vi.fn().mockImplementationOnce(() => { throw new Error("stale"); });
    const state = makeState({ lastExtensionContext: { ui: { setWorkingMessage } } as unknown as ExtensionContext });
    mockRunClassifierWithFallbacksDetailed.mockImplementation(async (_a: unknown, _b: unknown, _c: unknown, _d: unknown, _e: unknown, onAttempt: (entry: { model: string; thinking?: string; source?: string }) => void) => {
      onAttempt({ model: "openai/gpt", source: "profile", thinking: "high" });
      return { result: { tier: "medium", reasoning: "ok" }, attempts: [] };
    });
    const res = await runClassifierBranch(makeRegistry(), profile, state, ctx, undefined, 0, new Set<string>(), "fallbackSrc");
    expect(res.result?.tier).toBe("medium");
    // first call threw and was caught, second call clears message
    expect(setWorkingMessage).toHaveBeenCalledTimes(2);
    expect(setWorkingMessage).toHaveBeenLastCalledWith(undefined);
  });

  it("given onAttempt with undefined source and undefined thinking then uses classifierSource fallback and no thinking suffix", async () => {
    const setWorkingMessage = vi.fn();
    const state = makeState({ lastExtensionContext: { ui: { setWorkingMessage } } as unknown as ExtensionContext });
    mockRunClassifierWithFallbacksDetailed.mockImplementation(async (_a: unknown, _b: unknown, _c: unknown, _d: unknown, _e: unknown, onAttempt: (entry: { model: string; thinking?: string; source?: string }) => void) => {
      // source undefined -> should fallback to classifierSource, thinking undefined -> no # suffix
      onAttempt({ model: "openai/gpt", source: undefined, thinking: undefined });
      return { result: { tier: "low", reasoning: "ok" }, attempts: [] };
    });
    await runClassifierBranch(makeRegistry(), profile, state, ctx, undefined, 0, new Set<string>(), "fallbackSrc");
    expect(setWorkingMessage).toHaveBeenCalledWith("Classifying via fallbackSrc (openai/gpt)...");
  });

  it("given onAttempt thinking undefined vs defined both covered and entry.source ?? classifierSource both branches", async () => {
    const setWorkingMessage = vi.fn();
    const state = makeState({ lastExtensionContext: { ui: { setWorkingMessage } } as unknown as ExtensionContext });
    // need to capture that both template branches work: we call onAttempt twice with different entries
    mockRunClassifierWithFallbacksDetailed.mockImplementation(async (_a: unknown, _b: unknown, _c: unknown, _d: unknown, _e: unknown, onAttempt: (entry: { model: string; thinking?: string; source?: string }) => void) => {
      onAttempt({ model: "openai/a", thinking: undefined, source: undefined });
      onAttempt({ model: "openai/b", thinking: "high" as unknown as string, source: "global" });
      return { result: { tier: "high", reasoning: "ok" }, attempts: [] };
    });
    await runClassifierBranch(makeRegistry(), profile, state, ctx, undefined, 0, new Set<string>(), "fallbackSrc");
    expect(setWorkingMessage).toHaveBeenCalledWith("Classifying via fallbackSrc (openai/a)...");
    expect(setWorkingMessage).toHaveBeenCalledWith("Classifying via global (openai/b#high)...");
  });

  it("given failedSet empty then does not persist", async () => {
    const state = makeState();
    mockRunClassifierWithFallbacksDetailed.mockResolvedValue({ result: { tier: "high", reasoning: "ok" }, attempts: [] });
    const failedSet = new Set<string>();
    await runClassifierBranch(makeRegistry(), profile, state, ctx, undefined, 0, failedSet, "profile");
    expect(state.failedByChain.has(CLASSIFIER_CHAIN_KEY)).toBe(false);
  });

  it("given failedSet non-empty then persists", async () => {
    const state = makeState();
    mockRunClassifierWithFallbacksDetailed.mockResolvedValue({ result: { tier: "high", reasoning: "ok" }, attempts: [] });
    const failedSet = new Set<string>(["openai/gpt"]);
    await runClassifierBranch(makeRegistry(), profile, state, ctx, undefined, 0, failedSet, "profile");
    expect(state.failedByChain.get(CLASSIFIER_CHAIN_KEY)).toBe(failedSet);
  });

  it("given result present then returns result and attempts", async () => {
    const state = makeState();
    mockRunClassifierWithFallbacksDetailed.mockResolvedValue({
      result: { tier: "minimal", reasoning: "decided" },
      attempts: [{ model: "openai/gpt", thinking: "low" }],
    });
    const res = await runClassifierBranch(makeRegistry(), profile, state, ctx, undefined, 0, new Set<string>(), "profile");
    expect(res.result?.tier).toBe("minimal");
    expect(res.attempts).toHaveLength(1);
  });

  it("given result undefined with attempts then throws with attempted list covering thinking defined vs undefined", async () => {
    const state = makeState();
    mockRunClassifierWithFallbacksDetailed.mockResolvedValue({
      result: undefined,
      attempts: [
        { model: "openai/a", thinking: "high" as unknown as string, error: "auth failed" },
        { model: "openai/b", thinking: undefined, error: "parse error" },
      ],
    });
    await expect(
      runClassifierBranch(makeRegistry(), profile, state, ctx, undefined, 0, new Set<string>(), "mySource"),
    ).rejects.toThrow("Attempted: openai/a#high (auth failed), openai/b (parse error)");
  });

  it("given result undefined with no attempts then throws with none", async () => {
    const state = makeState();
    mockRunClassifierWithFallbacksDetailed.mockResolvedValue({ result: undefined, attempts: [] });
    await expect(
      runClassifierBranch(makeRegistry(), profile, state, ctx, undefined, 0, new Set<string>(), "mySource"),
    ).rejects.toThrow("Attempted: none");
  });

  it("given lastExtensionContext undefined then optional chaining covers undefined path", async () => {
    const state = makeState({ lastExtensionContext: undefined });
    mockRunClassifierWithFallbacksDetailed.mockImplementation(async (_a: unknown, _b: unknown, _c: unknown, _d: unknown, _e: unknown, onAttempt: (entry: { model: string; source?: string }) => void) => {
      onAttempt({ model: "openai/gpt", source: "profile" });
      return { result: { tier: "high", reasoning: "ok" }, attempts: [] };
    });
    const res = await runClassifierBranch(makeRegistry(), profile, state, ctx, undefined, 0, new Set<string>(), "profile");
    expect(res.result?.tier).toBe("high");
  });

  it("given final setWorkingMessage throws stale then caught", async () => {
    const setWorkingMessage = vi.fn()
      .mockImplementationOnce(() => {}) // onAttempt succeeds
      .mockImplementationOnce(() => { throw new Error("stale context"); }); // final clear throws
    const state = makeState({ lastExtensionContext: { ui: { setWorkingMessage } } as unknown as ExtensionContext });
    mockRunClassifierWithFallbacksDetailed.mockImplementation(async (_a: unknown, _b: unknown, _c: unknown, _d: unknown, _e: unknown, onAttempt: (entry: { model: string }) => void) => {
      onAttempt({ model: "openai/gpt" });
      return { result: { tier: "low", reasoning: "ok" }, attempts: [] };
    });
    const res = await runClassifierBranch(makeRegistry(), profile, state, ctx, undefined, 0, new Set<string>(), "src");
    expect(res.result?.tier).toBe("low");
    expect(setWorkingMessage).toHaveBeenCalledWith(undefined);
  });

  it("given failedSet non-empty and final stale then still persists and returns", async () => {
    const setWorkingMessage = vi.fn().mockImplementation(() => { throw new Error("stale"); });
    const state = makeState({ lastExtensionContext: { ui: { setWorkingMessage } } as unknown as ExtensionContext });
    mockRunClassifierWithFallbacksDetailed.mockImplementation(async (_a: unknown, _b: unknown, _c: unknown, _d: unknown, _e: unknown, onAttempt: (entry: { model: string }) => void) => {
      onAttempt({ model: "openai/gpt" });
      return { result: { tier: "high", reasoning: "ok" }, attempts: [] };
    });
    const failedSet = new Set<string>(["openai/gpt"]);
    const res = await runClassifierBranch(makeRegistry(), profile, state, ctx, undefined, 0, failedSet, "src");
    expect(res.result?.tier).toBe("high");
    expect(state.failedByChain.get(CLASSIFIER_CHAIN_KEY)).toBe(failedSet);
  });
});
