import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runTypesafeEntry, typesafeLabel } from "../../src/provider/typesafeEntry";
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
const entry = { typesafe: true, model: "jev" } as const;

const makeState = (
  over: {
    typesafeConfidenceThreshold?: number;
    tierGuides?: TierGuides;
    lastExtensionContext?: ExtensionContext | undefined;
  } = {},
) => ({
  currentConfig: {
    ...(over.typesafeConfidenceThreshold === undefined
      ? {}
      : { typesafeConfidenceThreshold: over.typesafeConfidenceThreshold }),
    ...(over.tierGuides === undefined ? {} : { tierGuides: over.tierGuides }),
  },
  lastExtensionContext: over.lastExtensionContext,
});

const okResult = (tier: "low" | "high", confidence: number) => ({
  result: {
    tier,
    reasoning: `TypeSafe chose ${tier} (confidence ${confidence.toFixed(2)}).`,
    confidence,
    probabilities: undefined,
  },
});

describe("runTypesafeEntry 동작을 검증함", () => {
  beforeEach(() => vi.clearAllMocks());

  it("label은 typesafe/<model> 형식임을 검증함", () => {
    expect(typesafeLabel("jev-latest")).toBe("typesafe/jev-latest");
  });

  it("이미 abort된 signal이면 호출 없이 aborted를 던짐을 검증함", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runTypesafeEntry(entry, makeState(), ctx, 0, controller.signal)).rejects.toThrow(
      "aborted",
    );
    expect(mockClassifyWithTypesafe).not.toHaveBeenCalled();
  });

  it("성공하면 result를 반환하고 working message를 정리함을 검증함", async () => {
    const ui = makeFakeUi();
    mockClassifyWithTypesafe.mockResolvedValue(okResult("high", 0.8));
    const outcome = await runTypesafeEntry(
      entry,
      makeState({ lastExtensionContext: makeFakeExtensionContext({ ui }) }),
      ctx,
      0,
      undefined,
    );
    expect(outcome).toEqual({
      result: { tier: "high", reasoning: "TypeSafe chose high (confidence 0.80)." },
    });
    expect(ui.setWorkingMessage).toHaveBeenNthCalledWith(1, "Classifying via TypeSafe (jev)...");
    expect(ui.setWorkingMessage).toHaveBeenNthCalledWith(2, undefined);
  });

  it("entry model·historySize·기본 임계값을 넘김을 검증함", async () => {
    mockClassifyWithTypesafe.mockResolvedValue(okResult("low", 0.9));
    await runTypesafeEntry(entry, makeState(), ctx, 3, undefined);
    expect(mockClassifyWithTypesafe).toHaveBeenCalledWith(
      expect.objectContaining({ model: "jev", historySize: 3, confidenceThreshold: 0.5 }),
    );
  });

  it("설정된 임계값과 tierGuides를 넘김을 검증함", async () => {
    mockClassifyWithTypesafe.mockResolvedValue(okResult("low", 0.9));
    await runTypesafeEntry(
      { typesafe: true, model: "jev-latest" },
      makeState({ typesafeConfidenceThreshold: 0.8, tierGuides: { low: "커스텀" } }),
      ctx,
      0,
      undefined,
    );
    expect(mockClassifyWithTypesafe).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "jev-latest",
        confidenceThreshold: 0.8,
        tierGuides: { low: "커스텀" },
      }),
    );
  });

  it("실패하면 attempt를 반환함을 검증함", async () => {
    const ui = makeFakeUi();
    mockClassifyWithTypesafe.mockResolvedValue({ error: "TypeSafe request failed (401): nope" });
    const outcome = await runTypesafeEntry(
      entry,
      makeState({ lastExtensionContext: makeFakeExtensionContext({ ui }) }),
      ctx,
      0,
      undefined,
    );
    expect(outcome).toEqual({
      attempt: { model: "typesafe/jev", error: "TypeSafe request failed (401): nope" },
    });
    expect(ui.setWorkingMessage).toHaveBeenNthCalledWith(2, undefined);
  });

  it("abort 에러면 aborted를 던짐을 검증함", async () => {
    mockClassifyWithTypesafe.mockResolvedValue({ error: "aborted" });
    await expect(runTypesafeEntry(entry, makeState(), ctx, 0, undefined)).rejects.toThrow(
      "aborted",
    );
  });

  it("ui.setWorkingMessage가 예외를 던져도 무시함을 검증함", async () => {
    mockClassifyWithTypesafe.mockResolvedValue(okResult("low", 0.9));
    const ui = makeFakeUi({
      setWorkingMessage: vi.fn(() => {
        throw new Error("stale");
      }),
    });
    const outcome = await runTypesafeEntry(
      entry,
      makeState({ lastExtensionContext: makeFakeExtensionContext({ ui }) }),
      ctx,
      0,
      undefined,
    );
    expect(outcome).toEqual({
      result: { tier: "low", reasoning: "TypeSafe chose low (confidence 0.90)." },
    });
  });
});
