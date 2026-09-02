/* oxlint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runClassifierBranch } from "../../src/provider/classifierBranch";
import { CLASSIFIER_CHAIN_KEY } from "../../src/failureMemory";

vi.mock("../../src/config", async () => {
  const actual = (await vi.importActual("../../src/config")) as any;
  return { ...actual, resolveEffectiveClassifier: vi.fn() };
});
vi.mock("../../src/classifier", async () => {
  const actual = (await vi.importActual("../../src/classifier")) as any;
  return { ...actual, runClassifierWithFallbacksDetailed: vi.fn() };
});

import { resolveEffectiveClassifier } from "../../src/config";
import { runClassifierWithFallbacksDetailed } from "../../src/classifier";

const mockRegistry = { find: vi.fn(), getApiKeyAndHeaders: vi.fn() } as any;
const baseProfile = { high: { models: ["openai/gpt"] } } as any;

const makeState = (over: any = {}) => ({
  currentConfig: {
    classifierModels: [{ model: "openai/gpt" }],
    historySize: 0,
    ...over.currentConfig,
  },
  failedByChain: new Map<string, Set<string>>(over.failedByChain),
  lastExtensionContext: over.lastExtensionContext,
});

const ctx = { messages: [{ role: "user", content: "hi", timestamp: 1 }] } as any;

describe("runClassifierBranch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when no effectiveClassifiers", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: undefined,
      source: "none",
    } as any);
    await expect(
      runClassifierBranch(
        mockRegistry,
        baseProfile,
        makeState() as any,
        ctx,
        undefined,
        0,
        new Set(),
        "src",
      ),
    ).rejects.toThrow("No classifier available");
  });

  it("throws when signal aborted", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ model: "openai/gpt" }],
      source: "global",
    } as any);
    const signal = { aborted: true } as any;
    await expect(
      runClassifierBranch(
        mockRegistry,
        baseProfile,
        makeState() as any,
        ctx,
        signal,
        0,
        new Set(),
        "src",
      ),
    ).rejects.toThrow("aborted");
  });

  it("success with result and persists failedSet", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ model: "openai/gpt", source: "global" }],
      source: "global",
    } as any);
    const failedSet = new Set<string>(["x"]);
    vi.mocked(runClassifierWithFallbacksDetailed).mockImplementation(
      async (_a: any, _b: any, _c: any, _d: any, _e: any, onAttempt: any, _f: any) => {
        onAttempt({ model: "openai/gpt", thinking: "high", source: "global" });
        return { result: { tier: "high", reasoning: "r" }, attempts: [] } as any;
      },
    );
    const state: any = makeState();
    state.failedByChain = new Map();
    const ui = { setWorkingMessage: vi.fn() };
    state.lastExtensionContext = { ui } as any;
    const res = await runClassifierBranch(
      mockRegistry,
      baseProfile,
      state,
      ctx,
      undefined,
      0,
      failedSet,
      "src",
    );
    expect(res.result?.tier).toBe("high");
    expect(state.failedByChain.get(CLASSIFIER_CHAIN_KEY)).toBe(failedSet);
    expect(ui.setWorkingMessage).toHaveBeenCalledWith(
      expect.stringContaining("Classifying via global"),
    );
    expect(ui.setWorkingMessage).toHaveBeenCalledWith(undefined);
  });

  it("success with entry.source fallback and no thinking", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ model: "openai/gpt" }],
      source: "global",
    } as any);
    vi.mocked(runClassifierWithFallbacksDetailed).mockImplementation(
      async (_a: any, _b: any, _c: any, _d: any, _e: any, onAttempt: any) => {
        onAttempt({ model: "openai/gpt" }); // no source, no thinking
        return { result: { tier: "low", reasoning: "r" }, attempts: [] } as any;
      },
    );
    const state: any = makeState();
    const ui = { setWorkingMessage: vi.fn() };
    state.lastExtensionContext = { ui } as any;
    const res = await runClassifierBranch(
      mockRegistry,
      baseProfile,
      state,
      ctx,
      undefined,
      0,
      new Set(),
      "fallbackSrc",
    );
    expect(res.result?.tier).toBe("low");
    expect(ui.setWorkingMessage).toHaveBeenCalledWith(expect.stringContaining("fallbackSrc"));
  });

  it("stale UI catch on setWorkingMessage", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ model: "openai/gpt" }],
      source: "global",
    } as any);
    vi.mocked(runClassifierWithFallbacksDetailed).mockImplementation(
      async (_a: any, _b: any, _c: any, _d: any, _e: any, onAttempt: any) => {
        onAttempt({ model: "openai/gpt" });
        return { result: { tier: "high", reasoning: "r" }, attempts: [] } as any;
      },
    );
    const state: any = makeState();
    state.lastExtensionContext = {
      ui: {
        setWorkingMessage: vi.fn(() => {
          throw new Error("stale");
        }),
      },
    } as any;
    const res = await runClassifierBranch(
      mockRegistry,
      baseProfile,
      state,
      ctx,
      undefined,
      0,
      new Set(),
      "src",
    );
    expect(res.result).toBeDefined();
    // second setWorkingMessage(undefined) also stale, should not throw
  });

  it("throws when classifier fails with attempts", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ model: "openai/gpt" }],
      source: "global",
    } as any);
    vi.mocked(runClassifierWithFallbacksDetailed).mockResolvedValue({
      result: undefined,
      attempts: [{ model: "openai/gpt", thinking: "high", error: "no tier" }],
    } as any);
    const state: any = makeState();
    await expect(
      runClassifierBranch(mockRegistry, baseProfile, state, ctx, undefined, 0, new Set(), "src"),
    ).rejects.toThrow("Classifier failed");
  });

  it("throws with none when attempts empty", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ model: "openai/gpt" }],
      source: "global",
    } as any);
    vi.mocked(runClassifierWithFallbacksDetailed).mockResolvedValue({
      result: undefined,
      attempts: [],
    } as any);
    const state: any = makeState();
    await expect(
      runClassifierBranch(mockRegistry, baseProfile, state, ctx, undefined, 0, new Set(), "src"),
    ).rejects.toThrow("none");
  });

  it("maps attempts without thinking", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ model: "openai/gpt" }],
      source: "global",
    } as any);
    vi.mocked(runClassifierWithFallbacksDetailed).mockResolvedValue({
      result: undefined,
      attempts: [{ model: "openai/gpt", error: "e" }],
    } as any);
    const state: any = makeState();
    await expect(
      runClassifierBranch(mockRegistry, baseProfile, state, ctx, undefined, 0, new Set(), "src"),
    ).rejects.toThrow("openai/gpt (e)");
  });

  it("does not persist empty failedSet", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ model: "openai/gpt" }],
      source: "global",
    } as any);
    vi.mocked(runClassifierWithFallbacksDetailed).mockResolvedValue({
      result: { tier: "high", reasoning: "r" },
      attempts: [],
    } as any);
    const state: any = makeState();
    state.failedByChain = new Map();
    const emptySet = new Set<string>();
    await runClassifierBranch(mockRegistry, baseProfile, state, ctx, undefined, 0, emptySet, "src");
    expect(state.failedByChain.has(CLASSIFIER_CHAIN_KEY)).toBe(false);
  });

  it("handles undefined lastExtensionContext", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ model: "openai/gpt" }],
      source: "global",
    } as any);
    vi.mocked(runClassifierWithFallbacksDetailed).mockResolvedValue({
      result: { tier: "high", reasoning: "r" },
      attempts: [],
    } as any);
    const state: any = makeState({ lastExtensionContext: undefined });
    const res = await runClassifierBranch(
      mockRegistry,
      baseProfile,
      state,
      ctx,
      undefined,
      0,
      new Set(),
      "src",
    );
    expect(res.result).toBeDefined();
  });
});
