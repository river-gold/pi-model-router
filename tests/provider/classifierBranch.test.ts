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

describe("runClassifierBranch 분류 브랜치 실행", () => {
  beforeEach(() => vi.clearAllMocks());

  it("effectiveClassifiers가 없으면 throw", async () => {
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

  it("signal이 aborted면 throw", async () => {
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

  it("result 성공 시 failedSet 저장", async () => {
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

  it("entry.source fallback으로 성공하고 thinking이 없을 때 처리", async () => {
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

  it("setWorkingMessage의 stale UI 예외 처리", async () => {
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

  it("attempts와 함께 classifier가 실패하면 throw", async () => {
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

  it("attempts가 비어 있으면 none과 함께 throw", async () => {
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

  it("thinking 없는 attempts 매핑", async () => {
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

  it("빈 failedSet은 저장하지 않음", async () => {
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

  it("currentConfig의 tierGuides 전달", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ model: "openai/gpt" }],
      source: "global",
    } as any);
    vi.mocked(runClassifierWithFallbacksDetailed).mockResolvedValue({
      result: { tier: "low", reasoning: "r" },
      attempts: [],
    } as any);
    const guides = { low: "custom low guide" };
    const state: any = makeState({ currentConfig: { tierGuides: guides } });
    await runClassifierBranch(
      mockRegistry,
      baseProfile,
      state,
      ctx,
      undefined,
      0,
      new Set(),
      "src",
    );
    const call = vi.mocked(runClassifierWithFallbacksDetailed).mock.calls[0];
    expect(call[7]).toBe(guides);
  });

  it("lastExtensionContext가 undefined인 경우 처리", async () => {
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
