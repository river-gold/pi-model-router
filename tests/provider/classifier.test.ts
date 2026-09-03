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

describe("provider/classifier", () => {
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

  it("returns decision when isSingleTier", async () => {
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

  it("returns when isToolLoopNow", async () => {
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

  it("returns when thinkingLevel not off", async () => {
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

  it("uses historySize 0 when undefined", async () => {
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

  it("uses historySize when defined", async () => {
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

  it("uses failedSet from map", async () => {
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

  it("creates new Set when not in map", async () => {
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

  it("builds decision when tier equals result", async () => {
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

  it("returns incoming decision when classifier branch rejects", async () => {
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
  it("returns incoming decision when classifier result undefined", async () => {
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
  it("rethrows abort instead of falling back", async () => {
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
  it("resolves when tier differs", async () => {
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
