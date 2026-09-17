import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runTypesafeBranch, TYPESAFE_CLASSIFIER_LABEL } from "../../src/provider/typesafeBranch";
import type * as TypesafeModule from "../../src/typesafe";
import type { TierGuides } from "../../src/types";
import { makeFakeExtensionContext, makeFakeUi } from "../helpers";

const { mockClassifyWithTypesafe } = vi.hoisted(() => ({
  mockClassifyWithTypesafe: vi.fn(),
}));

vi.mock("../../src/typesafe", async () => {
  const actual = await vi.importActual<typeof TypesafeModule>("../../src/typesafe");
  return { ...actual, classifyWithTypesafe: mockClassifyWithTypesafe };
});

const ctx: Context = { messages: [{ role: "user", content: "hi", timestamp: 1 }] };

const makeState = (
  over: {
    typesafeConfidenceThreshold?: number;
    historySize?: number;
    tierGuides?: TierGuides;
    lastExtensionContext?: ExtensionContext | undefined;
  } = {},
) => ({
  currentConfig: {
    ...(over.typesafeConfidenceThreshold === undefined
      ? {}
      : { typesafeConfidenceThreshold: over.typesafeConfidenceThreshold }),
    ...(over.historySize === undefined ? {} : { historySize: over.historySize }),
    ...(over.tierGuides === undefined ? {} : { tierGuides: over.tierGuides }),
  },
  lastExtensionContext: over.lastExtensionContext,
});

describe("runTypesafeBranch 동작을 검증함", () => {
  beforeEach(() => vi.clearAllMocks());

  it("이미 abort된 signal이면 호출 없이 aborted를 던짐을 검증함", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runTypesafeBranch(makeState(), ctx, controller.signal)).rejects.toThrow("aborted");
    expect(mockClassifyWithTypesafe).not.toHaveBeenCalled();
  });

  it("성공하면 tier와 reasoning을 반환하고 working message를 정리함을 검증함", async () => {
    const ui = makeFakeUi();
    mockClassifyWithTypesafe.mockResolvedValue({
      result: {
        tier: "high",
        reasoning: "TypeSafe chose high (confidence 0.80).",
        confidence: 0.8,
        probabilities: { high: 0.8, medium: 0.2 },
      },
    });
    const result = await runTypesafeBranch(
      makeState({ lastExtensionContext: makeFakeExtensionContext({ ui }) }),
      ctx,
      undefined,
    );
    expect(result).toEqual({
      tier: "high",
      reasoning: "TypeSafe chose high (confidence 0.80).",
    });
    expect(ui.setWorkingMessage).toHaveBeenNthCalledWith(
      1,
      "Classifying via TypeSafe (jev-latest)...",
    );
    expect(ui.setWorkingMessage).toHaveBeenNthCalledWith(2, undefined);
  });

  it("기본 임계값(0.5)과 historySize 0을 넘김을 검증함", async () => {
    mockClassifyWithTypesafe.mockResolvedValue({
      result: { tier: "low", reasoning: "r", confidence: 0.9, probabilities: undefined },
    });
    await runTypesafeBranch(makeState(), ctx, undefined);
    expect(mockClassifyWithTypesafe).toHaveBeenCalledWith(
      expect.objectContaining({ historySize: 0, confidenceThreshold: 0.5 }),
    );
  });

  it("설정된 임계값·historySize·tierGuides를 넘김을 검증함", async () => {
    mockClassifyWithTypesafe.mockResolvedValue({
      result: { tier: "low", reasoning: "r", confidence: 0.9, probabilities: undefined },
    });
    await runTypesafeBranch(
      makeState({
        typesafeConfidenceThreshold: 0.8,
        historySize: 4,
        tierGuides: { low: "커스텀" },
      }),
      ctx,
      undefined,
    );
    expect(mockClassifyWithTypesafe).toHaveBeenCalledWith(
      expect.objectContaining({
        historySize: 4,
        confidenceThreshold: 0.8,
        tierGuides: { low: "커스텀" },
      }),
    );
  });

  it("실패하면 undefined를 반환함을 검증함", async () => {
    const ui = makeFakeUi();
    mockClassifyWithTypesafe.mockResolvedValue({ error: "TYPESAFE_API_KEY is not set." });
    const result = await runTypesafeBranch(
      makeState({ lastExtensionContext: makeFakeExtensionContext({ ui }) }),
      ctx,
      undefined,
    );
    expect(result).toBeUndefined();
    expect(ui.setWorkingMessage).toHaveBeenNthCalledWith(2, undefined);
    expect(TYPESAFE_CLASSIFIER_LABEL).toBe("typesafe/jev-latest");
  });

  it("abort 에러면 aborted를 던짐을 검증함", async () => {
    mockClassifyWithTypesafe.mockResolvedValue({ error: "aborted" });
    await expect(runTypesafeBranch(makeState(), ctx, undefined)).rejects.toThrow("aborted");
  });

  it("ui.setWorkingMessage가 예외를 던져도 무시함을 검증함", async () => {
    mockClassifyWithTypesafe.mockResolvedValue({
      result: { tier: "low", reasoning: "r", confidence: 0.9, probabilities: undefined },
    });
    const ui = makeFakeUi({
      setWorkingMessage: vi.fn(() => {
        throw new Error("stale");
      }),
    });
    const result = await runTypesafeBranch(
      makeState({ lastExtensionContext: makeFakeExtensionContext({ ui }) }),
      ctx,
      undefined,
    );
    expect(result?.tier).toBe("low");
  });
});
