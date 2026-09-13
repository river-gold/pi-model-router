import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Context } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runClassifierBranch } from "../../src/provider/classifierBranch";
import { CLASSIFIER_CHAIN_KEY } from "../../src/failureMemory";
import type * as ConfigModule from "../../src/config";
import type * as ClassifierModule from "../../src/classifier";
import type { ClassifierConfig, RouterProfile, TierGuides } from "../../src/types";
import { makeFakeRegistry, makeFakeUi, makeFakeExtensionContext, fakeSignal } from "../helpers";

vi.mock("../../src/config", async () => {
  const actual = await vi.importActual<typeof ConfigModule>("../../src/config");
  return { ...actual, resolveEffectiveClassifier: vi.fn() };
});
vi.mock("../../src/classifier", async () => {
  const actual = await vi.importActual<typeof ClassifierModule>("../../src/classifier");
  return { ...actual, runClassifierWithFallbacksDetailed: vi.fn() };
});

import { resolveEffectiveClassifier } from "../../src/config";
import { runClassifierWithFallbacksDetailed } from "../../src/classifier";

const mockRegistry = makeFakeRegistry();
const baseProfile: RouterProfile = { high: { models: ["openai/gpt"] } };

const makeState = (
  over: {
    currentConfig?: {
      classifierModels?: ClassifierConfig[];
      historySize?: number;
      tierGuides?: TierGuides;
    };
    failedByChain?: Map<string, Set<string>>;
    lastExtensionContext?: ExtensionContext | undefined;
  } = {},
) => ({
  currentConfig: {
    classifierModels: [{ model: "openai/gpt" }],
    historySize: 0,
    ...over.currentConfig,
  },
  failedByChain: new Map<string, Set<string>>(over.failedByChain),
  lastExtensionContext: over.lastExtensionContext,
});

const ctx: Context = { messages: [{ role: "user", content: "hi", timestamp: 1 }] };

describe("runClassifierBranch 분류 브랜치 실행", () => {
  beforeEach(() => vi.clearAllMocks());

  it("effectiveClassifiers가 없으면 throw", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: undefined,
      source: "none",
    });
    await expect(
      runClassifierBranch(
        mockRegistry,
        baseProfile,
        makeState(),
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
      classifiers: [{ model: "openai/gpt", source: "global" }],
      source: "global",
    });
    const signal = fakeSignal(true);
    await expect(
      runClassifierBranch(mockRegistry, baseProfile, makeState(), ctx, signal, 0, new Set(), "src"),
    ).rejects.toThrow("aborted");
  });

  it("result 성공 시 failedSet 저장", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ model: "openai/gpt", source: "global" }],
      source: "global",
    });
    const failedSet = new Set<string>(["x"]);
    vi.mocked(runClassifierWithFallbacksDetailed).mockImplementation(
      async (_a, _b, _c, _d, _e, onAttempt, _f) => {
        onAttempt?.({ model: "openai/gpt", thinking: "high", source: "global" });
        return { result: { tier: "high", reasoning: "r" }, attempts: [] };
      },
    );
    const setWorkingMessage = vi.fn();
    const ui = makeFakeUi({ setWorkingMessage });
    const state = makeState({ lastExtensionContext: makeFakeExtensionContext({ ui }) });
    state.failedByChain = new Map();
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
    expect(setWorkingMessage).toHaveBeenCalledWith(
      expect.stringContaining("Classifying via global"),
    );
    expect(setWorkingMessage).toHaveBeenCalledWith(undefined);
  });

  it("entry.source fallback으로 성공하고 thinking이 없을 때 처리", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ model: "openai/gpt", source: "global" }],
      source: "global",
    });
    vi.mocked(runClassifierWithFallbacksDetailed).mockImplementation(
      async (_a, _b, _c, _d, _e, onAttempt) => {
        onAttempt?.({ model: "openai/gpt" }); // no source, no thinking
        return { result: { tier: "low", reasoning: "r" }, attempts: [] };
      },
    );
    const setWorkingMessage = vi.fn();
    const ui = makeFakeUi({ setWorkingMessage });
    const state = makeState({ lastExtensionContext: makeFakeExtensionContext({ ui }) });
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
    expect(setWorkingMessage).toHaveBeenCalledWith(expect.stringContaining("fallbackSrc"));
  });

  it("setWorkingMessage의 stale UI 예외 처리", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ model: "openai/gpt", source: "global" }],
      source: "global",
    });
    vi.mocked(runClassifierWithFallbacksDetailed).mockImplementation(
      async (_a, _b, _c, _d, _e, onAttempt) => {
        onAttempt?.({ model: "openai/gpt" });
        return { result: { tier: "high", reasoning: "r" }, attempts: [] };
      },
    );
    const ui = makeFakeUi({
      setWorkingMessage: vi.fn(() => {
        throw new Error("stale");
      }),
    });
    const state = makeState({ lastExtensionContext: makeFakeExtensionContext({ ui }) });
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
      classifiers: [{ model: "openai/gpt", source: "global" }],
      source: "global",
    });
    vi.mocked(runClassifierWithFallbacksDetailed).mockResolvedValue({
      result: undefined,
      attempts: [{ model: "openai/gpt", thinking: "high", error: "no tier" }],
    });
    const state = makeState();
    await expect(
      runClassifierBranch(mockRegistry, baseProfile, state, ctx, undefined, 0, new Set(), "src"),
    ).rejects.toThrow("Classifier failed");
  });

  it("attempts가 비어 있으면 none과 함께 throw", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ model: "openai/gpt", source: "global" }],
      source: "global",
    });
    vi.mocked(runClassifierWithFallbacksDetailed).mockResolvedValue({
      result: undefined,
      attempts: [],
    });
    const state = makeState();
    await expect(
      runClassifierBranch(mockRegistry, baseProfile, state, ctx, undefined, 0, new Set(), "src"),
    ).rejects.toThrow("none");
  });

  it("thinking 없는 attempts 매핑", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ model: "openai/gpt", source: "global" }],
      source: "global",
    });
    vi.mocked(runClassifierWithFallbacksDetailed).mockResolvedValue({
      result: undefined,
      attempts: [{ model: "openai/gpt", error: "e" }],
    });
    const state = makeState();
    await expect(
      runClassifierBranch(mockRegistry, baseProfile, state, ctx, undefined, 0, new Set(), "src"),
    ).rejects.toThrow("openai/gpt (e)");
  });

  it("빈 failedSet은 저장하지 않음", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ model: "openai/gpt", source: "global" }],
      source: "global",
    });
    vi.mocked(runClassifierWithFallbacksDetailed).mockResolvedValue({
      result: { tier: "high", reasoning: "r" },
      attempts: [],
    });
    const state = makeState();
    state.failedByChain = new Map();
    const emptySet = new Set<string>();
    await runClassifierBranch(mockRegistry, baseProfile, state, ctx, undefined, 0, emptySet, "src");
    expect(state.failedByChain.has(CLASSIFIER_CHAIN_KEY)).toBe(false);
  });

  it("currentConfig의 tierGuides 전달", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ model: "openai/gpt", source: "global" }],
      source: "global",
    });
    vi.mocked(runClassifierWithFallbacksDetailed).mockResolvedValue({
      result: { tier: "low", reasoning: "r" },
      attempts: [],
    });
    const guides = { low: "custom low guide" };
    const state = makeState({ currentConfig: { tierGuides: guides } });
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
      classifiers: [{ model: "openai/gpt", source: "global" }],
      source: "global",
    });
    vi.mocked(runClassifierWithFallbacksDetailed).mockResolvedValue({
      result: { tier: "high", reasoning: "r" },
      attempts: [],
    });
    const state = makeState({ lastExtensionContext: undefined });
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

  it("profileName과 profiles를 resolveEffectiveClassifier에 전달함", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ model: "openai/gpt", source: "profile" }],
      source: "profile",
    });
    vi.mocked(runClassifierWithFallbacksDetailed).mockResolvedValue({
      result: { tier: "low", reasoning: "r" },
      attempts: [],
    });
    const profiles: Record<string, RouterProfile> = {
      myModel: { classifierModels: { ref: "base##off" } },
      base: { low: { models: ["openai/gpt"] } },
    };
    const state = makeState();
    const res = await runClassifierBranch(
      mockRegistry,
      profiles.myModel!,
      state,
      ctx,
      undefined,
      0,
      new Set(),
      "src",
      undefined,
      "myModel",
      profiles,
    );
    expect(res.result?.tier).toBe("low");
    expect(resolveEffectiveClassifier).toHaveBeenCalledWith(
      profiles.myModel,
      state.currentConfig.classifierModels,
      profiles,
      "myModel",
    );
  });
});
