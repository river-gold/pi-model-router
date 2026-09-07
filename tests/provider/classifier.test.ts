import { describe, expect, it, vi, beforeEach } from "vitest";
import { applyClassifierIfNeeded } from "../../src/provider/classifier";

vi.mock("../../src/provider/classifierBranch", () => ({
  runClassifierBranch: vi.fn(),
}));

vi.mock("../../src/routing", () => ({
  resolveAvailableTier: vi.fn((profile, tier) => tier),
  buildRoutingDecision: vi.fn((modelId, profile, tier, reasoning, isClassifier) => ({
    profile: modelId,
    tier,
    reasoning,
    isClassifier,
  })),
}));

import { runClassifierBranch } from "../../src/provider/classifierBranch";
import { resolveAvailableTier, buildRoutingDecision } from "../../src/routing";

describe("provider/classifier 분류기 적용", () => {
  const mockDecision = { tier: "medium", reasoning: "orig" } as any;
  const mockProfile = { medium: { models: ["openai/a"] } } as any;
  const makeState = (historySize?: number, failedSet?: Set<string>) => ({
    currentConfig: { historySize, profiles: {} } as any,
    failedByChain: {
      get: vi.fn().mockReturnValue(failedSet),
    } as any,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (resolveAvailableTier as unknown as ReturnType<typeof vi.fn>).mockImplementation((_, t) => t);
    (buildRoutingDecision as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (modelId, profile, tier, reasoning) => ({ profile: modelId, tier, reasoning }) as any,
    );
    (runClassifierBranch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      result: { tier: "high", reasoning: "classifier reason" },
    } as any);
  });

  it("isSingleTier일 때 기존 decision 반환", async () => {
    const state = makeState();
    const result = await applyClassifierIfNeeded(
      mockProfile,
      mockDecision,
      "modelId",
      {} as any,
      state as any,
      {} as any,
      undefined,
      true,
      false,
      "off" as any,
      "source",
    );
    expect(result).toBe(mockDecision);
    expect(runClassifierBranch).not.toHaveBeenCalled();
  });

  it("isToolLoopNow일 때 기존 decision 반환", async () => {
    const state = makeState();
    const result = await applyClassifierIfNeeded(
      mockProfile,
      mockDecision,
      "modelId",
      {} as any,
      state as any,
      {} as any,
      undefined,
      false,
      true,
      "off" as any,
      "source",
    );
    expect(result).toBe(mockDecision);
  });

  it("thinkingLevel이 off가 아니면 기존 decision 반환", async () => {
    const state = makeState();
    for (const lvl of ["high", "low", "medium", "max", "minimal", "xhigh"] as const) {
      const r = await applyClassifierIfNeeded(
        mockProfile,
        mockDecision,
        "modelId",
        {} as any,
        state as any,
        {} as any,
        undefined,
        false,
        false,
        lvl as any,
        "source",
      );
      expect(r).toBe(mockDecision);
    }
  });

  it("historySize가 undefined이면 0 사용", async () => {
    const state = makeState(undefined);
    await applyClassifierIfNeeded(
      mockProfile,
      mockDecision,
      "modelId",
      {} as any,
      state as any,
      {} as any,
      undefined,
      false,
      false,
      "off" as any,
      "source",
    );
    expect(runClassifierBranch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      0,
      expect.any(Set),
      "source",
    );
  });

  it("historySize가 정의되어 있으면 해당 값 사용", async () => {
    const state = makeState(5);
    await applyClassifierIfNeeded(
      mockProfile,
      mockDecision,
      "modelId",
      {} as any,
      state as any,
      {} as any,
      undefined,
      false,
      false,
      "off" as any,
      "source",
    );
    expect(runClassifierBranch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      5,
      expect.any(Set),
      "source",
    );
  });

  it("map에 저장된 failedSet 사용", async () => {
    const set = new Set(["a"]);
    const state = makeState(0, set);
    await applyClassifierIfNeeded(
      mockProfile,
      mockDecision,
      "modelId",
      {} as any,
      state as any,
      {} as any,
      undefined,
      false,
      false,
      "off" as any,
      "source",
    );
    expect(runClassifierBranch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      0,
      set,
      "source",
    );
  });

  it("map에 없으면 새로운 Set 생성", async () => {
    const state = makeState(0, undefined);
    await applyClassifierIfNeeded(
      mockProfile,
      mockDecision,
      "modelId",
      {} as any,
      state as any,
      {} as any,
      undefined,
      false,
      false,
      "off" as any,
      "source",
    );
    const calledSet = (runClassifierBranch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][6];
    expect(calledSet).toBeInstanceOf(Set);
    expect(calledSet.size).toBe(0);
  });

  it("tier가 result와 같으면 decision 생성", async () => {
    (resolveAvailableTier as unknown as ReturnType<typeof vi.fn>).mockReturnValue("high");
    (runClassifierBranch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      result: { tier: "high", reasoning: "r" },
    } as any);
    const state = makeState();
    const result = await applyClassifierIfNeeded(
      mockProfile,
      mockDecision,
      "myModel",
      {} as any,
      state as any,
      {} as any,
      undefined,
      false,
      false,
      "off" as any,
      "source",
    );
    expect(buildRoutingDecision).toHaveBeenCalledWith(
      "myModel",
      mockProfile,
      "high",
      "Classifier: r",
      true,
    );
    expect(result.tier).toBe("high");
  });

  it("classifier branch가 reject되면 들어온 decision 반환", async () => {
    (runClassifierBranch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Classifier failed to determine a tier."),
    );
    const state = makeState();
    const result = await applyClassifierIfNeeded(
      mockProfile,
      mockDecision,
      "myModel",
      {} as any,
      state as any,
      {} as any,
      undefined,
      false,
      false,
      "off" as any,
      "source",
    );
    expect(result).toBe(mockDecision);
  });
  it("classifier result가 undefined이면 들어온 decision 반환", async () => {
    (runClassifierBranch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      result: undefined,
    } as any);
    const state = makeState();
    const result = await applyClassifierIfNeeded(
      mockProfile,
      mockDecision,
      "myModel",
      {} as any,
      state as any,
      {} as any,
      undefined,
      false,
      false,
      "off" as any,
      "source",
    );
    expect(result).toBe(mockDecision);
  });
  it("abort는 fallback 없이 다시 throw", async () => {
    (runClassifierBranch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("aborted"),
    );
    const state = makeState();
    await expect(
      applyClassifierIfNeeded(
        mockProfile,
        mockDecision,
        "myModel",
        {} as any,
        state as any,
        {} as any,
        undefined,
        false,
        false,
        "off" as any,
        "source",
      ),
    ).rejects.toThrow("aborted");
  });
  it("tier가 다르면 resolve하여 반환", async () => {
    (resolveAvailableTier as unknown as ReturnType<typeof vi.fn>).mockReturnValue("medium");
    (runClassifierBranch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      result: { tier: "high", reasoning: "r" },
    } as any);
    const state = makeState();
    const result = await applyClassifierIfNeeded(
      mockProfile,
      mockDecision,
      "myModel",
      {} as any,
      state as any,
      {} as any,
      undefined,
      false,
      false,
      "off" as any,
      "source",
    );
    expect(result.reasoning).toContain("Resolved from high to medium");
    expect(buildRoutingDecision).toHaveBeenCalledWith(
      "myModel",
      mockProfile,
      "medium",
      expect.stringContaining("Resolved from high"),
      true,
    );
  });
});
