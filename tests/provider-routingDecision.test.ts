import { describe, expect, it } from "vitest";
import type { Context } from "@earendil-works/pi-ai";
import type { RouterProfile, RoutingDecision } from "../src/types";
import { buildRoutingDecision } from "../src/routing";
import { resolveRoutingDecision } from "../src/provider/routingDecision";

const baseContext = {
  messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
} as unknown as Context;

const fullProfile: RouterProfile = {
  minimal: { models: ["openai/minimal"] },
  low: { models: ["openai/low"] },
  medium: { models: ["openai/medium"] },
  high: { models: ["openai/high"] },
  xhigh: { models: ["openai/xhigh"] },
  max: { models: ["openai/max"] },
} as unknown as RouterProfile;

const mediumProfile: RouterProfile = {
  medium: { models: ["openai/medium"] },
} as unknown as RouterProfile;

const highProfile: RouterProfile = {
  high: { models: ["openai/high"] },
} as unknown as RouterProfile;

const lowProfile: RouterProfile = {
  low: { models: ["openai/low"] },
} as unknown as RouterProfile;

const highMediumProfile: RouterProfile = {
  high: { models: ["openai/high"] },
  medium: { models: ["openai/medium"] },
} as unknown as RouterProfile;

const makeSnapshot = (tier: "high" | "medium" | "low" | "minimal" | "xhigh" | "max" = "high"): RoutingDecision =>
  buildRoutingDecision("balanced", fullProfile, tier, "prev", false);

describe("resolveRoutingDecision", () => {
  it("defaults to decideRouting when off, not singleTier, not toolLoop", () => {
    const decision = resolveRoutingDecision({
      profileName: "balanced",
      profile: mediumProfile,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "off",
      isToolLoop: false,
      singleTier: undefined,
      validTierCount: 0,
    });
    expect(decision.tier).toBe("medium");
    expect(decision.reasoning).toContain("Defaulted to medium");
  });

  it("defaults to decideRouting when thinking off and isToolLoop false and isSingleTier false (snapshot defined ignored)", () => {
    const snapshot = makeSnapshot("high");
    const decision = resolveRoutingDecision({
      profileName: "balanced",
      profile: mediumProfile,
      context: baseContext,
      snapshotLastDecision: snapshot,
      thinkingLevel: "off",
      isToolLoop: false,
      singleTier: undefined,
      validTierCount: 2,
    });
    expect(decision.tier).toBe("medium");
    expect(decision.reasoning).toContain("Defaulted to medium");
  });

  it("preserves snapshot tier during tool loop", () => {
    const snapshot = makeSnapshot("high");
    const decision = resolveRoutingDecision({
      profileName: "balanced",
      profile: fullProfile,
      context: baseContext,
      snapshotLastDecision: snapshot,
      thinkingLevel: "high",
      isToolLoop: true,
      singleTier: "high",
      validTierCount: 1,
    });
    expect(decision.tier).toBe("high");
    expect(decision.reasoning).toContain("Preserved high tier during toolResult loop");
  });

  it("does not preserve when isToolLoop true but snapshot undefined", () => {
    const decision = resolveRoutingDecision({
      profileName: "balanced",
      profile: mediumProfile,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "high",
      isToolLoop: true,
      singleTier: "high",
      validTierCount: 1,
    });
    // isToolLoop true blocks singleTier and thinking mapping, so falls back to decideRouting
    expect(decision.tier).toBe("medium");
    expect(decision.reasoning).toContain("Defaulted to medium");
  });

  it("does not preserve when isToolLoop false even with snapshot defined", () => {
    const snapshot = makeSnapshot("high");
    const decision = resolveRoutingDecision({
      profileName: "balanced",
      profile: mediumProfile,
      context: baseContext,
      snapshotLastDecision: snapshot,
      thinkingLevel: "off",
      isToolLoop: false,
      singleTier: undefined,
      validTierCount: 5,
    });
    expect(decision.tier).toBe("medium");
  });

  it("uses single tier when validTierCount 1 and singleTier defined and not toolLoop", () => {
    const decision = resolveRoutingDecision({
      profileName: "single",
      profile: highProfile,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "off",
      isToolLoop: false,
      singleTier: "high",
      validTierCount: 1,
    });
    expect(decision.tier).toBe("high");
    expect(decision.reasoning).toContain('Single tier "high"');
  });

  it("single tier skips thinking mapping even when thinking is high", () => {
    const decision = resolveRoutingDecision({
      profileName: "single",
      profile: highProfile,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "high",
      isToolLoop: false,
      singleTier: "high",
      validTierCount: 1,
    });
    expect(decision.tier).toBe("high");
    expect(decision.reasoning).toContain("Single tier");
  });

  it("tool loop takes precedence over single tier when both would apply", () => {
    const snapshot = makeSnapshot("medium");
    const decision = resolveRoutingDecision({
      profileName: "balanced",
      profile: fullProfile,
      context: baseContext,
      snapshotLastDecision: snapshot,
      thinkingLevel: "off",
      isToolLoop: true,
      singleTier: "high",
      validTierCount: 1,
    });
    expect(decision.tier).toBe("medium");
    expect(decision.reasoning).toContain("Preserved medium");
    expect(decision.reasoning).not.toContain("Single tier");
  });

  it("does not use single tier when validTierCount is 1 but singleTier undefined -> falls to thinking mapping", () => {
    const decision = resolveRoutingDecision({
      profileName: "balanced",
      profile: fullProfile,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "high",
      isToolLoop: false,
      singleTier: undefined,
      validTierCount: 1,
    });
    // isSingleTier = false because singleTier undefined, so thinking mapping applies
    expect(decision.tier).toBe("high");
    expect(decision.reasoning).toContain("Thinking level high mapped to high tier.");
  });

  it("does not use single tier when validTierCount >1 even with singleTier defined -> falls to thinking mapping", () => {
    const decision = resolveRoutingDecision({
      profileName: "balanced",
      profile: fullProfile,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "low",
      isToolLoop: false,
      singleTier: "high",
      validTierCount: 2,
    });
    expect(decision.tier).toBe("low");
    expect(decision.reasoning).toContain("Thinking level low mapped to low tier.");
  });

  it("maps thinking high to exact tier without fallback", () => {
    const decision = resolveRoutingDecision({
      profileName: "balanced",
      profile: fullProfile,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "high",
      isToolLoop: false,
      singleTier: undefined,
      validTierCount: 3,
    });
    expect(decision.tier).toBe("high");
    expect(decision.reasoning).toBe("Thinking level high mapped to high tier.");
  });

  it("maps thinking high with fallback when preferred not configured", () => {
    const decision = resolveRoutingDecision({
      profileName: "balanced",
      profile: mediumProfile,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "high",
      isToolLoop: false,
      singleTier: undefined,
      validTierCount: 1,
    });
    // preferred high not in profile, resolveAvailableTier falls to medium
    expect(decision.tier).toBe("medium");
    expect(decision.reasoning).toBe(
      "Thinking level high mapped to high tier, resolved to medium (high tier is not configured).",
    );
  });

  it("maps thinking minimal with fallback to low", () => {
    const profileWithLow: RouterProfile = {
      low: { models: ["openai/low"] },
      medium: { models: ["openai/medium"] },
    } as unknown as RouterProfile;
    const decision = resolveRoutingDecision({
      profileName: "balanced",
      profile: profileWithLow,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "minimal",
      isToolLoop: false,
      singleTier: undefined,
      validTierCount: 2,
    });
    expect(decision.tier).toBe("low");
    expect(decision.reasoning).toContain("resolved to low");
    expect(decision.reasoning).toContain("minimal tier is not configured");
  });

  it("maps thinking low exact without fallback", () => {
    const decision = resolveRoutingDecision({
      profileName: "balanced",
      profile: lowProfile,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "low",
      isToolLoop: false,
      singleTier: undefined,
      validTierCount: 1,
    });
    expect(decision.tier).toBe("low");
    expect(decision.reasoning).toBe("Thinking level low mapped to low tier.");
  });

  it("maps thinking minimal exact when minimal configured", () => {
    const minimalProfile: RouterProfile = {
      minimal: { models: ["openai/minimal"] },
      medium: { models: ["openai/medium"] },
    } as unknown as RouterProfile;
    const decision = resolveRoutingDecision({
      profileName: "balanced",
      profile: minimalProfile,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "minimal",
      isToolLoop: false,
      singleTier: undefined,
      validTierCount: 2,
    });
    expect(decision.tier).toBe("minimal");
    expect(decision.reasoning).toBe("Thinking level minimal mapped to minimal tier.");
  });

  it("maps thinking max with fallback (covers xhigh/max branches)", () => {
    const decision = resolveRoutingDecision({
      profileName: "balanced",
      profile: lowProfile,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "max",
      isToolLoop: false,
      singleTier: undefined,
      validTierCount: 3,
    });
    // max preferred not available, falls to low (nearest)
    expect(decision.tier).toBe("low");
    expect(decision.reasoning).toContain("max tier is not configured");
  });

  it("maps thinking xhigh exact", () => {
    const xhighProfile: RouterProfile = {
      xhigh: { models: ["openai/xhigh"] },
    } as unknown as RouterProfile;
    const decision = resolveRoutingDecision({
      profileName: "balanced",
      profile: xhighProfile,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "xhigh",
      isToolLoop: false,
      singleTier: undefined,
      validTierCount: 1,
    });
    expect(decision.tier).toBe("xhigh");
    expect(decision.reasoning).toBe("Thinking level xhigh mapped to xhigh tier.");
  });

  it("does not apply thinking mapping when isToolLoop true even with high thinking", () => {
    const decision = resolveRoutingDecision({
      profileName: "balanced",
      profile: fullProfile,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "high",
      isToolLoop: true,
      singleTier: undefined,
      validTierCount: 3,
    });
    expect(decision.tier).toBe("medium");
    expect(decision.reasoning).toContain("Defaulted to medium");
  });

  it("does not apply thinking mapping when thinkingLevel off", () => {
    const decision = resolveRoutingDecision({
      profileName: "balanced",
      profile: fullProfile,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "off",
      isToolLoop: false,
      singleTier: undefined,
      validTierCount: 6,
    });
    expect(decision.tier).toBe("medium");
    expect(decision.reasoning).toContain("Defaulted to medium");
  });

  it("covers validTierCount 0 with singleTier defined -> not singleTier", () => {
    const decision = resolveRoutingDecision({
      profileName: "balanced",
      profile: fullProfile,
      context: baseContext,
      snapshotLastDecision: undefined,
      thinkingLevel: "medium",
      isToolLoop: false,
      singleTier: "high",
      validTierCount: 0,
    });
    // validTierCount 0 => isSingleTier false, so thinking maps to medium
    expect(decision.tier).toBe("medium");
    expect(decision.reasoning).toBe("Thinking level medium mapped to medium tier.");
  });

  it("thinking mapping uses snapshotLastDecision irrelevant when not toolLoop", () => {
    const snapshot = makeSnapshot("low");
    const decision = resolveRoutingDecision({
      profileName: "balanced",
      profile: fullProfile,
      context: baseContext,
      snapshotLastDecision: snapshot,
      thinkingLevel: "high",
      isToolLoop: false,
      singleTier: undefined,
      validTierCount: 3,
    });
    expect(decision.tier).toBe("high");
    expect(decision.reasoning).toContain("Thinking level high");
  });
});
