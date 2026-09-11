/* oxlint-disable */
import { describe, it, expect } from "vitest";
import { resolveRoutingDecision } from "../../src/provider/routingDecision";
import type { RouterProfile } from "../../src/types";

const baseContext = { messages: [{ role: "user", content: "hi", timestamp: 1 }] } as any;

describe("resolveRoutingDecision 라우팅 결정", () => {
  it("tool loop tier 유지", () => {
    const profile: RouterProfile = { high: { models: ["openai/gpt"] } as any };
    const snap: any = { tier: "high", profile: "balanced" };
    const d = resolveRoutingDecision({
      profileName: "balanced",
      profile,
      context: baseContext,
      snapshotLastDecision: snap,
      thinkingLevel: "high" as any,
      isToolLoop: true,
      singleTier: "high" as any,
      validTierCount: 1,
    });
    expect(d.tier).toBe("high");
    expect(d.reasoning).toContain("Preserved");
  });

  it("single tier는 classifier 건너뜀", () => {
    const profile: RouterProfile = { low: { models: ["openai/gpt"] } as any };
    const d = resolveRoutingDecision({
      profileName: "balanced",
      profile,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "off" as any,
      isToolLoop: false,
      singleTier: "low" as any,
      validTierCount: 1,
    });
    expect(d.tier).toBe("low");
    expect(d.reasoning).toContain("Single tier");
  });

  it("thinking level이 가능하면 tier에 매핑", () => {
    const profile: RouterProfile = { high: { models: ["openai/gpt"] } as any };
    const d = resolveRoutingDecision({
      profileName: "balanced",
      profile,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "high" as any,
      isToolLoop: false,
      singleTier: undefined,
      validTierCount: 2,
    });
    expect(d.tier).toBe("high");
    expect(d.reasoning).toContain("Thinking level high mapped to high");
  });

  it("선호 tier가 없으면 thinking level을 다른 tier로 resolve", () => {
    const profile: RouterProfile = { low: { models: ["openai/gpt"] } as any };
    const d = resolveRoutingDecision({
      profileName: "balanced",
      profile,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "high" as any,
      isToolLoop: false,
      singleTier: undefined,
      validTierCount: 1,
    });
    // high not available, low is singleTier but isToolLoop false and isSingleTier true would have already returned low
    // Use validTierCount 2 with only low to force resolveAvailableTier fallback
    const profile2: RouterProfile = {
      low: { models: ["openai/gpt"] },
      medium: { models: ["openai/gpt2"] },
    } as any;
    const d2 = resolveRoutingDecision({
      profileName: "balanced",
      profile: profile2,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "max" as any,
      isToolLoop: false,
      singleTier: undefined,
      validTierCount: 2,
    });
    // max not configured, should resolve to minimal->low or medium, so tier !== preferred
    expect(d2.reasoning).toContain("resolved to");
    expect(d2.tier).not.toBe("max");
  });

  it("off thinking이고 single tier가 없으면 decideRouting 기본값 반환", () => {
    const profile: RouterProfile = { medium: { models: ["openai/gpt"] } as any };
    const d = resolveRoutingDecision({
      profileName: "balanced",
      profile,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "off" as any,
      isToolLoop: false,
      singleTier: undefined,
      validTierCount: 1,
    });
    expect(d.tier).toBe("medium");
  });
});

describe("resolveRoutingDecision 논리적 ref", () => {
  const liveProfiles = {
    balanced: {
      high: { models: ["openai/gpt-high"] },
      medium: { ref: "base#high" },
    },
    base: { high: { models: ["openai/gpt-base"] } },
  } as any;
  it("profiles가 있으면 ref 추적 thinking 매핑", () => {
    const d = resolveRoutingDecision({
      profileName: "balanced",
      profile: liveProfiles.balanced,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "medium" as any,
      isToolLoop: false,
      singleTier: undefined,
      validTierCount: 2,
      profiles: liveProfiles,
    });
    expect(d.tier).toBe("medium");
    expect(d.targetModelId).toBe("gpt-base");
    expect(d.reasoning).toContain("[ref:");
  });
  it("profiles가 있어도 해석 불가면 throw", () => {
    expect(() =>
      resolveRoutingDecision({
        profileName: "broken",
        profile: { medium: { ref: "missing#high" } } as any,
        context: baseContext,
        snapshotLastDecision: undefined,
        thinkingLevel: "high" as any,
        isToolLoop: false,
        singleTier: undefined,
        validTierCount: 1,
        profiles: { broken: { medium: { ref: "missing#high" } } } as any,
      }),
    ).toThrow(/no resolvable configuration/);
  });
});
