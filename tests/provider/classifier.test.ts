import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Context } from "@earendil-works/pi-ai";
import { applyClassifierIfNeeded } from "../../src/provider/classifier";
import { CLASSIFIER_CHAIN_KEY } from "../../src/failureMemory";
import type * as ClassifierBranchModule from "../../src/provider/classifierBranch";
import type * as RoutingModule from "../../src/routing";
import type { RouterProfile } from "../../src/types";
import { makeFakeRegistry, makeFakeProviderState, makeFakeDecision } from "../helpers";

const {
  mockRunClassifierBranch,
  mockResolveAvailableTier,
  mockBuildRoutingDecision,
  mockBuildRoutingDecisionLive,
} = vi.hoisted(() => ({
  mockRunClassifierBranch: vi.fn(),
  mockResolveAvailableTier: vi.fn(),
  mockBuildRoutingDecision: vi.fn(),
  mockBuildRoutingDecisionLive: vi.fn(),
}));

vi.mock("../../src/provider/classifierBranch", async () => {
  const actual = await vi.importActual<typeof ClassifierBranchModule>(
    "../../src/provider/classifierBranch",
  );
  return { ...actual, runClassifierBranch: mockRunClassifierBranch };
});

vi.mock("../../src/routing", async () => {
  const actual = await vi.importActual<typeof RoutingModule>("../../src/routing");
  return {
    ...actual,
    resolveAvailableTier: mockResolveAvailableTier,
    buildRoutingDecision: mockBuildRoutingDecision,
    buildRoutingDecisionLive: mockBuildRoutingDecisionLive,
  };
});

describe("provider/classifier 분류기 적용", () => {
  const mockDecision = makeFakeDecision({ tier: "medium", reasoning: "orig" });
  const mockProfile: RouterProfile = { medium: { models: ["openai/a"] } };
  const baseContext: Context = { messages: [{ role: "user", content: "hi", timestamp: 1 }] };
  const makeState = (historySize?: number, failedSet?: Set<string>) =>
    makeFakeProviderState({
      currentConfig: { profiles: {}, historySize },
      failedByChain: new Map<string, Set<string>>(
        failedSet === undefined ? [] : [[CLASSIFIER_CHAIN_KEY, failedSet]],
      ),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAvailableTier.mockImplementation((_, t) => t);
    mockBuildRoutingDecision.mockImplementation((modelId, profile, tier, reasoning) => ({
      profile: modelId,
      tier,
      reasoning,
    }));
    mockBuildRoutingDecisionLive.mockImplementation(
      (profiles, modelId, tier, reasoning, isClassifier) => ({
        profile: modelId,
        tier,
        reasoning,
        isClassifier,
      }),
    );
    mockRunClassifierBranch.mockResolvedValue({
      result: { tier: "high", reasoning: "classifier reason" },
    });
  });

  it("isSingleTier일 때 기존 decision 반환", async () => {
    const state = makeState();
    const result = await applyClassifierIfNeeded(
      mockProfile,
      mockDecision,
      "modelId",
      makeFakeRegistry(),
      state,
      baseContext,
      undefined,
      true,
      false,
      "off",
      "source",
    );
    expect(result).toBe(mockDecision);
    expect(mockRunClassifierBranch).not.toHaveBeenCalled();
  });

  it("isToolLoopNow일 때 기존 decision 반환", async () => {
    const state = makeState();
    const result = await applyClassifierIfNeeded(
      mockProfile,
      mockDecision,
      "modelId",
      makeFakeRegistry(),
      state,
      baseContext,
      undefined,
      false,
      true,
      "off",
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
        makeFakeRegistry(),
        state,
        baseContext,
        undefined,
        false,
        false,
        lvl,
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
      makeFakeRegistry(),
      state,
      baseContext,
      undefined,
      false,
      false,
      "off",
      "source",
    );
    expect(mockRunClassifierBranch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      0,
      expect.any(Set),
      "source",
      undefined,
      "modelId",
      undefined,
    );
  });

  it("historySize가 정의되어 있으면 해당 값 사용", async () => {
    const state = makeState(5);
    await applyClassifierIfNeeded(
      mockProfile,
      mockDecision,
      "modelId",
      makeFakeRegistry(),
      state,
      baseContext,
      undefined,
      false,
      false,
      "off",
      "source",
    );
    expect(mockRunClassifierBranch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      5,
      expect.any(Set),
      "source",
      undefined,
      "modelId",
      undefined,
    );
  });

  it("map에 저장된 failedSet 사용", async () => {
    const set = new Set(["a"]);
    const state = makeState(0, set);
    await applyClassifierIfNeeded(
      mockProfile,
      mockDecision,
      "modelId",
      makeFakeRegistry(),
      state,
      baseContext,
      undefined,
      false,
      false,
      "off",
      "source",
    );
    expect(mockRunClassifierBranch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      0,
      set,
      "source",
      undefined,
      "modelId",
      undefined,
    );
  });

  it("sessionId가 주어지면 runClassifierBranch에 전달한다", async () => {
    const state = makeState(0);
    await applyClassifierIfNeeded(
      mockProfile,
      mockDecision,
      "modelId",
      makeFakeRegistry(),
      state,
      baseContext,
      undefined,
      false,
      false,
      "off",
      "source",
      "sess-7",
    );
    expect(mockRunClassifierBranch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      0,
      expect.any(Set),
      "source",
      "sess-7",
      "modelId",
      undefined,
    );
  });

  it("map에 없으면 새로운 Set 생성", async () => {
    const state = makeState(0, undefined);
    await applyClassifierIfNeeded(
      mockProfile,
      mockDecision,
      "modelId",
      makeFakeRegistry(),
      state,
      baseContext,
      undefined,
      false,
      false,
      "off",
      "source",
    );
    const calledSet = mockRunClassifierBranch.mock.calls[0][6];
    expect(calledSet).toBeInstanceOf(Set);
    expect(calledSet.size).toBe(0);
  });

  it("tier가 result와 같으면 decision 생성", async () => {
    mockResolveAvailableTier.mockReturnValue("high");
    mockRunClassifierBranch.mockResolvedValue({
      result: { tier: "high", reasoning: "r" },
    });
    const state = makeState();
    const result = await applyClassifierIfNeeded(
      mockProfile,
      mockDecision,
      "myModel",
      makeFakeRegistry(),
      state,
      baseContext,
      undefined,
      false,
      false,
      "off",
      "source",
    );
    expect(mockBuildRoutingDecision).toHaveBeenCalledWith(
      "myModel",
      mockProfile,
      "high",
      "Classifier: r",
      true,
    );
    expect(result.tier).toBe("high");
  });

  it("classifier branch가 reject되면 들어온 decision 반환", async () => {
    mockRunClassifierBranch.mockRejectedValue(new Error("Classifier failed to determine a tier."));
    const state = makeState();
    const result = await applyClassifierIfNeeded(
      mockProfile,
      mockDecision,
      "myModel",
      makeFakeRegistry(),
      state,
      baseContext,
      undefined,
      false,
      false,
      "off",
      "source",
    );
    expect(result).toBe(mockDecision);
  });
  it("classifier result가 undefined이면 들어온 decision 반환", async () => {
    mockRunClassifierBranch.mockResolvedValue({
      result: undefined,
    });
    const state = makeState();
    const result = await applyClassifierIfNeeded(
      mockProfile,
      mockDecision,
      "myModel",
      makeFakeRegistry(),
      state,
      baseContext,
      undefined,
      false,
      false,
      "off",
      "source",
    );
    expect(result).toBe(mockDecision);
  });
  it("abort는 fallback 없이 다시 throw", async () => {
    mockRunClassifierBranch.mockRejectedValue(new Error("aborted"));
    const state = makeState();
    await expect(
      applyClassifierIfNeeded(
        mockProfile,
        mockDecision,
        "myModel",
        makeFakeRegistry(),
        state,
        baseContext,
        undefined,
        false,
        false,
        "off",
        "source",
      ),
    ).rejects.toThrow("aborted");
  });
  it("tier가 다르면 resolve하여 반환", async () => {
    mockResolveAvailableTier.mockReturnValue("medium");
    mockRunClassifierBranch.mockResolvedValue({
      result: { tier: "high", reasoning: "r" },
    });
    const state = makeState();
    const result = await applyClassifierIfNeeded(
      mockProfile,
      mockDecision,
      "myModel",
      makeFakeRegistry(),
      state,
      baseContext,
      undefined,
      false,
      false,
      "off",
      "source",
    );
    expect(result.reasoning).toContain("Resolved from high to medium");
    expect(mockBuildRoutingDecision).toHaveBeenCalledWith(
      "myModel",
      mockProfile,
      "medium",
      expect.stringContaining("Resolved from high"),
      true,
    );
  });
});

describe("provider/classifier 논리적 ref", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  const liveProfiles: Record<string, RouterProfile> = {
    myModel: { high: { ref: "base#high" } },
    base: { high: { models: ["openai/gpt-base"] } },
  };
  const baseContext: Context = { messages: [{ role: "user", content: "hi", timestamp: 1 }] };
  const callLive = (profiles: Record<string, RouterProfile>, modelId = "myModel") => {
    const state = makeFakeProviderState({
      currentConfig: { historySize: 0, profiles: {} },
      failedByChain: new Map(),
    });
    return applyClassifierIfNeeded(
      { high: { ref: "base#high" } },
      makeFakeDecision({ tier: "medium", reasoning: "orig" }),
      modelId,
      makeFakeRegistry(),
      state,
      baseContext,
      undefined,
      false,
      false,
      "off",
      "source",
      undefined,
      profiles,
    );
  };
  it("profiles가 있으면 live 결정으로 반환함", async () => {
    mockRunClassifierBranch.mockResolvedValue({
      result: { tier: "high", reasoning: "classifier reason" },
    });
    const result = await callLive(liveProfiles);
    expect(mockBuildRoutingDecisionLive).toHaveBeenCalledWith(
      liveProfiles,
      "myModel",
      "high",
      expect.stringContaining("Classifier:"),
      true,
    );
    expect(result).toEqual(
      expect.objectContaining({ profile: "myModel", tier: "high", isClassifier: true }),
    );
  });
  it("profiles에 없어도 요청 tier로 live 결정함", async () => {
    mockRunClassifierBranch.mockResolvedValue({
      result: { tier: "high", reasoning: "classifier reason" },
    });
    const result = await callLive({});
    expect(mockBuildRoutingDecisionLive).toHaveBeenCalledWith(
      {},
      "myModel",
      "high",
      expect.stringContaining("Classifier:"),
      true,
    );
    expect(result).toEqual(expect.objectContaining({ profile: "myModel" }));
  });
  it("기본 tier 자리가 위임 models면 분류기를 실행함", async () => {
    mockRunClassifierBranch.mockResolvedValue({
      result: { tier: "high", reasoning: "classifier reason" },
    });
    const profiles: Record<string, RouterProfile> = {
      myModel: { medium: { ref: "base#medium" } },
      base: { medium: { models: ["openai/gpt-base"] } },
    };
    const state = makeFakeProviderState({
      currentConfig: { historySize: 0, profiles: {} },
      failedByChain: new Map(),
    });
    await applyClassifierIfNeeded(
      profiles.myModel,
      makeFakeDecision({ profile: "myModel", tier: "medium", reasoning: "orig" }),
      "myModel",
      makeFakeRegistry(),
      state,
      baseContext,
      undefined,
      false,
      false,
      "off",
      "source",
      undefined,
      profiles,
    );
    expect(mockRunClassifierBranch).toHaveBeenCalled();
  });
  it("profileName과 profiles를 branch에 전달함을 검증함", async () => {
    mockRunClassifierBranch.mockResolvedValue({
      result: { tier: "high", reasoning: "classifier reason" },
    });
    const profiles: Record<string, RouterProfile> = {
      myModel: { medium: { ref: "base#medium" } },
      base: { medium: { models: ["openai/gpt-base"] } },
    };
    const state = makeFakeProviderState({
      currentConfig: { historySize: 0, profiles: {} },
      failedByChain: new Map(),
    });
    await applyClassifierIfNeeded(
      profiles.myModel,
      makeFakeDecision({ profile: "myModel", tier: "medium", reasoning: "orig" }),
      "myModel",
      makeFakeRegistry(),
      state,
      baseContext,
      undefined,
      false,
      false,
      "off",
      "source",
      undefined,
      profiles,
    );
    expect(mockRunClassifierBranch).toHaveBeenCalledWith(
      expect.anything(),
      profiles.myModel,
      expect.anything(),
      expect.anything(),
      undefined,
      0,
      expect.any(Set),
      "source",
      undefined,
      "myModel",
      profiles,
    );
  });
});
