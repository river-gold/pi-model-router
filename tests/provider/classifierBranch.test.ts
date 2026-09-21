import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Context } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runClassifierBranch } from "../../src/provider/classifierBranch";
import { CLASSIFIER_CHAIN_KEY } from "../../src/failureMemory";
import type * as ConfigModule from "../../src/config";
import type * as ClassifierModule from "../../src/classifier";
import type * as TypesafeEntryModule from "../../src/provider/typesafeEntry";
import type * as AgyEntryModule from "../../src/provider/agyEntry";
import type { ClassifierConfig, Router, TierGuides } from "../../src/types";
import { makeFakeRegistry, makeFakeUi, makeFakeExtensionContext, fakeSignal } from "../helpers";

vi.mock("../../src/config", async () => {
  const actual = await vi.importActual<typeof ConfigModule>("../../src/config");
  return { ...actual, resolveEffectiveClassifier: vi.fn() };
});
vi.mock("../../src/classifier", async () => {
  const actual = await vi.importActual<typeof ClassifierModule>("../../src/classifier");
  return { ...actual, runClassifierWithFallbacksDetailed: vi.fn() };
});
vi.mock("../../src/provider/typesafeEntry", async () => {
  const actual = await vi.importActual<TypesafeEntryModule>("../../src/provider/typesafeEntry");
  return { ...actual, runTypesafeEntry: mockRunTypesafeEntry };
});
vi.mock("../../src/provider/agyEntry", async () => {
  const actual = await vi.importActual<AgyEntryModule>("../../src/provider/agyEntry");
  return { ...actual, runAgyEntry: mockRunAgyEntry };
});

import { resolveEffectiveClassifier } from "../../src/config";
import { runClassifierWithFallbacksDetailed } from "../../src/classifier";

const { mockRunTypesafeEntry, mockRunAgyEntry } = vi.hoisted(() => ({
  mockRunTypesafeEntry: vi.fn(),
  mockRunAgyEntry: vi.fn(),
}));

const mockRegistry = makeFakeRegistry();
const baseRouter: Router = { high: { models: ["openai/gpt"] } };

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
        baseRouter,
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
      runClassifierBranch(mockRegistry, baseRouter, makeState(), ctx, signal, 0, new Set(), "src"),
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
        onAttempt?.({ model: "openai/gpt", effort: "high", source: "global" });
        return { result: { tier: "high", reasoning: "r" }, attempts: [] };
      },
    );
    const setWorkingMessage = vi.fn();
    const ui = makeFakeUi({ setWorkingMessage });
    const state = makeState({ lastExtensionContext: makeFakeExtensionContext({ ui }) });
    state.failedByChain = new Map();
    const res = await runClassifierBranch(
      mockRegistry,
      baseRouter,
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

  it("entry.source fallback으로 성공하고 effort가 없을 때 처리", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ model: "openai/gpt", source: "global" }],
      source: "global",
    });
    vi.mocked(runClassifierWithFallbacksDetailed).mockImplementation(
      async (_a, _b, _c, _d, _e, onAttempt) => {
        onAttempt?.({ model: "openai/gpt" }); // no source, no effort
        return { result: { tier: "low", reasoning: "r" }, attempts: [] };
      },
    );
    const setWorkingMessage = vi.fn();
    const ui = makeFakeUi({ setWorkingMessage });
    const state = makeState({ lastExtensionContext: makeFakeExtensionContext({ ui }) });
    const res = await runClassifierBranch(
      mockRegistry,
      baseRouter,
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
      baseRouter,
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
      attempts: [{ model: "openai/gpt", effort: "high", error: "no tier" }],
    });
    const state = makeState();
    await expect(
      runClassifierBranch(mockRegistry, baseRouter, state, ctx, undefined, 0, new Set(), "src"),
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
      runClassifierBranch(mockRegistry, baseRouter, state, ctx, undefined, 0, new Set(), "src"),
    ).rejects.toThrow("none");
  });

  it("effort 없는 attempts 매핑", async () => {
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
      runClassifierBranch(mockRegistry, baseRouter, state, ctx, undefined, 0, new Set(), "src"),
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
    await runClassifierBranch(mockRegistry, baseRouter, state, ctx, undefined, 0, emptySet, "src");
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
    await runClassifierBranch(mockRegistry, baseRouter, state, ctx, undefined, 0, new Set(), "src");
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
      baseRouter,
      state,
      ctx,
      undefined,
      0,
      new Set(),
      "src",
    );
    expect(res.result).toBeDefined();
  });

  it("TypeSafe 항목이 성공하면 LLM 분류기를 건너뜀을 검증함", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ typesafe: true, model: "jev", source: "global" }],
      source: "global",
    });
    mockRunTypesafeEntry.mockResolvedValue({
      result: { tier: "high", reasoning: "typesafe reason" },
    });
    const res = await runClassifierBranch(
      mockRegistry,
      baseRouter,
      makeState(),
      ctx,
      undefined,
      0,
      new Set(),
      "src",
    );
    expect(res.result).toEqual({ tier: "high", reasoning: "typesafe reason" });
    expect(runClassifierWithFallbacksDetailed).not.toHaveBeenCalled();
  });

  it("TypeSafe 실패 시 다음 LLM 항목으로 폴백함을 검증함", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [
        { typesafe: true, model: "jev", source: "global" },
        { model: "openai/gpt", source: "global" },
      ],
      source: "global",
    });
    mockRunTypesafeEntry.mockResolvedValue({
      attempt: { model: "typesafe/jev", error: "TypeSafe request failed (400)" },
    });
    vi.mocked(runClassifierWithFallbacksDetailed).mockResolvedValue({
      result: { tier: "low", reasoning: "llm reason" },
      attempts: [{ model: "openai/gpt" }],
    });
    const res = await runClassifierBranch(
      mockRegistry,
      baseRouter,
      makeState(),
      ctx,
      undefined,
      0,
      new Set(),
      "src",
    );
    expect(res.result).toEqual({ tier: "low", reasoning: "llm reason" });
    expect(runClassifierWithFallbacksDetailed).toHaveBeenCalledTimes(1);
    expect(res.attempts).toEqual([
      { model: "typesafe/jev", error: "TypeSafe request failed (400)" },
      { model: "openai/gpt" },
    ]);
  });

  it("LLM 실패 후 TypeSafe 항목을 시도함을 검증함", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [
        { model: "openai/gpt", source: "global" },
        { typesafe: true, model: "jev", source: "global" },
      ],
      source: "global",
    });
    vi.mocked(runClassifierWithFallbacksDetailed).mockResolvedValue({
      result: undefined,
      attempts: [{ model: "openai/gpt", error: "no tier" }],
    });
    mockRunTypesafeEntry.mockResolvedValue({
      result: { tier: "high", reasoning: "typesafe reason" },
    });
    const res = await runClassifierBranch(
      mockRegistry,
      baseRouter,
      makeState(),
      ctx,
      undefined,
      0,
      new Set(),
      "src",
    );
    expect(res.result?.tier).toBe("high");
    expect(mockRunTypesafeEntry).toHaveBeenCalledTimes(1);
  });

  it("TypeSafe와 LLM 모두 실패하면 attempt 목록과 함께 throw함을 검증함", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [
        { typesafe: true, model: "jev", source: "global" },
        { model: "openai/gpt", source: "global" },
      ],
      source: "global",
    });
    mockRunTypesafeEntry.mockResolvedValue({
      attempt: { model: "typesafe/jev", error: "boom" },
    });
    vi.mocked(runClassifierWithFallbacksDetailed).mockResolvedValue({
      result: undefined,
      attempts: [{ model: "openai/gpt", error: "no tier" }],
    });
    await expect(
      runClassifierBranch(
        mockRegistry,
        baseRouter,
        makeState(),
        ctx,
        undefined,
        0,
        new Set(),
        "src",
      ),
    ).rejects.toThrow("typesafe/jev (boom), openai/gpt (no tier)");
  });

  it("체인 도중 abort되면 throw함을 검증함", async () => {
    const controller = new AbortController();
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [
        { model: "openai/gpt", source: "global" },
        { model: "openai/gpt2", source: "global" },
      ],
      source: "global",
    });
    vi.mocked(runClassifierWithFallbacksDetailed).mockImplementation(async () => {
      controller.abort();
      return { result: undefined, attempts: [{ model: "openai/gpt", error: "no tier" }] };
    });
    await expect(
      runClassifierBranch(
        mockRegistry,
        baseRouter,
        makeState(),
        ctx,
        controller.signal,
        0,
        new Set(),
        "src",
      ),
    ).rejects.toThrow("aborted");
  });

  it("routers를 resolveEffectiveClassifier에 전달함", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ model: "openai/gpt", source: "router" }],
      source: "router",
    });
    vi.mocked(runClassifierWithFallbacksDetailed).mockResolvedValue({
      result: { tier: "low", reasoning: "r" },
      attempts: [],
    });
    const routers: Record<string, Router> = {
      myModel: { classifierModels: { ref: "base#low#off" } },
      base: { low: { models: ["openai/gpt"] } },
    };
    const state = makeState();
    const res = await runClassifierBranch(
      mockRegistry,
      routers.myModel!,
      state,
      ctx,
      undefined,
      0,
      new Set(),
      "src",
      undefined,
      "myModel",
      routers,
    );
    expect(res.result?.tier).toBe("low");
    expect(resolveEffectiveClassifier).toHaveBeenCalledWith(
      routers.myModel,
      state.currentConfig.classifierModels,
      routers,
    );
  });

  it("agy 항목이 성공하면 LLM 분류기를 건너뜀을 검증함", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [{ agy: true, model: "gemini-3.7-flash", source: "global" }],
      source: "global",
    });
    mockRunAgyEntry.mockResolvedValue({
      result: { tier: "high", reasoning: "agy reason" },
    });
    const res = await runClassifierBranch(
      mockRegistry,
      baseRouter,
      makeState(),
      ctx,
      undefined,
      0,
      new Set(),
      "src",
    );
    expect(res.result).toEqual({ tier: "high", reasoning: "agy reason" });
    expect(runClassifierWithFallbacksDetailed).not.toHaveBeenCalled();
    expect(mockRunAgyEntry).toHaveBeenCalledTimes(1);
  });

  it("agy 실패 시 다음 LLM 항목으로 폴백함을 검증함", async () => {
    vi.mocked(resolveEffectiveClassifier).mockReturnValue({
      classifiers: [
        { agy: true, model: "gemini-3.7-flash", source: "global" },
        { model: "openai/gpt", source: "global" },
      ],
      source: "global",
    });
    mockRunAgyEntry.mockResolvedValue({
      attempt: { model: "agy/gemini-3.7-flash", error: "agy classifier failed: timed out" },
    });
    vi.mocked(runClassifierWithFallbacksDetailed).mockResolvedValue({
      result: { tier: "low", reasoning: "llm reason" },
      attempts: [{ model: "openai/gpt" }],
    });
    const res = await runClassifierBranch(
      mockRegistry,
      baseRouter,
      makeState(),
      ctx,
      undefined,
      0,
      new Set(),
      "src",
    );
    expect(res.result).toEqual({ tier: "low", reasoning: "llm reason" });
    expect(res.attempts).toEqual([
      { model: "agy/gemini-3.7-flash", error: "agy classifier failed: timed out" },
      { model: "openai/gpt" },
    ]);
  });
});
