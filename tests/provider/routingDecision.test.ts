/* oxlint-disable */
import { describe, it, expect } from "vitest";
import { resolveRoutingDecision } from "../../src/provider/routingDecision";
import type { RouterProfile } from "../../src/types";
import type { Context, ToolResultMessage } from "@earendil-works/pi-ai";

const baseContext = { messages: [{ role: "user", content: "hi", timestamp: 1 }] } as any;

const toolResultMsg = (toolName: string): ToolResultMessage => ({
  role: "toolResult",
  toolCallId: "t1",
  toolName,
  content: [],
  isError: false,
  timestamp: 1,
});

describe("resolveRoutingDecision", () => {
  it("downgrades to lowest tier for read/bash tool loop", () => {
    const profile: RouterProfile = {
      high: { models: ["openai/gpt"] },
      low: { models: ["openai/gpt-cheap"] },
    } as any;
    const snap: any = { tier: "high", profile: "balanced" };
    const context = {
      messages: [{ role: "user", content: "hi", timestamp: 1 }, toolResultMsg("read")],
    } as unknown as Context;
    const d = resolveRoutingDecision({
      profileName: "balanced",
      profile,
      context,
      snapshotLastDecision: snap,
      thinkingLevel: "high" as any,
      isToolLoop: true,
      singleTier: undefined,
      validTierCount: 2,
    });
    expect(d.tier).toBe("low");
    expect(d.reasoning).toContain("Cheap tool loop");
    expect(d.baseTier).toBe("high");
  });

  it("keeps cheap override with mixed read/bash trailing results", () => {
    const profile: RouterProfile = {
      medium: { models: ["openai/gpt"] },
      minimal: { models: ["openai/gpt-cheap"] },
    } as any;
    const snap: any = { tier: "medium", profile: "balanced" };
    const context = {
      messages: [
        { role: "user", content: "hi", timestamp: 1 },
        toolResultMsg("bash"),
        toolResultMsg("read"),
      ],
    } as unknown as Context;
    const d = resolveRoutingDecision({
      profileName: "balanced",
      profile,
      context,
      snapshotLastDecision: snap,
      thinkingLevel: "off" as any,
      isToolLoop: true,
      singleTier: undefined,
      validTierCount: 2,
    });
    expect(d.tier).toBe("minimal");
    expect(d.baseTier).toBe("medium");
  });

  it("reverts to base tier after non-cheap tool result", () => {
    const profile: RouterProfile = {
      high: { models: ["openai/gpt"] },
      low: { models: ["openai/gpt-cheap"] },
    } as any;
    const snap: any = { tier: "low", profile: "balanced", baseTier: "high" };
    const context = {
      messages: [{ role: "user", content: "hi", timestamp: 1 }, toolResultMsg("edit")],
    } as unknown as Context;
    const d = resolveRoutingDecision({
      profileName: "balanced",
      profile,
      context,
      snapshotLastDecision: snap,
      thinkingLevel: "high" as any,
      isToolLoop: true,
      singleTier: undefined,
      validTierCount: 2,
    });
    expect(d.tier).toBe("high");
    expect(d.reasoning).toContain("Reverted to base high");
    expect(d.baseTier).toBeUndefined();
  });

  it("preserves tool loop tier without cheap tools and no baseTier", () => {
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

  it("single tier skips classifier", () => {
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

  it("thinking level maps to tier when available", () => {
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

  it("thinking level resolved to different tier when preferred not configured", () => {
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

  it("off thinking with no single tier returns decideRouting default", () => {
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
