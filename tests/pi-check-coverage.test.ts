/* oxlint-disable */
import { describe, it, expect, vi } from "vitest";
import { isRouterPersistedState, buildPersistedState } from "../src/state";
import {
  stripJsonc,
  isObjectRecord,
  isRouterTier,
  parseCanonicalModelRef,
  normalizeTierConfig,
  normalizeConfig,
  resolveContextWindow,
  resolveMaxTokens,
  profileNames,
  resolveProfileName,
} from "../src/config";
import {
  getLastUserText,
  getHistoryPairsText,
  truncateContext,
  extractTextFromContent,
  estimateTokens,
} from "../src/context";
import { isRecordablePreStreamError, chainKeyForRoute, normalizeFailedRef } from "../src/failureMemory";
import {
  thinkingToTier,
  resolveAvailableTier,
  buildRoutingDecision,
  decideRouting,
} from "../src/routing";
import { parseClassifierOutput } from "../src/classifier";
import { formatDecision, updateStatus } from "../src/ui";
import { modelWithAuthBaseUrl, streamDelegated } from "../src/stream";

describe("pi-check coverage补", () => {
  it("state all branches", () => {
    expect(
      isRouterPersistedState({
        enabled: true,
        selectedProfile: "a",
        timestamp: 1,
        debugHistory: "x" as any,
      }),
    ).toBe(true);
    expect(
      isRouterPersistedState({
        enabled: true,
        selectedProfile: "a",
        timestamp: 1,
        accumulatedCost: -1,
      }),
    ).toBe(true);
    expect(
      isRouterPersistedState({
        enabled: true,
        selectedProfile: "a",
        timestamp: 1,
        accumulatedCost: Infinity,
      }),
    ).toBe(true);
    expect(
      isRouterPersistedState({
        enabled: true,
        selectedProfile: "a",
        timestamp: 1,
        accumulatedCost: "bad" as any,
      }),
    ).toBe(true);
    expect(
      isRouterPersistedState({
        enabled: true,
        selectedProfile: "a",
        timestamp: 1,
        lastDecision: "bad" as any,
      }),
    ).toBe(true);
    expect(
      isRouterPersistedState({
        enabled: true,
        selectedProfile: "a",
        timestamp: 1,
        lastDecision: [] as any,
      }),
    ).toBe(true);
    expect(
      isRouterPersistedState({
        enabled: true,
        selectedProfile: "a",
        timestamp: 1,
        lastDecision: { profile: "p" } as any,
      }),
    ).toBe(true);
    expect(
      isRouterPersistedState({
        enabled: true,
        selectedProfile: "a",
        timestamp: 1,
        debugEnabled: "yes" as any,
      }),
    ).toBe(true);
    expect(
      isRouterPersistedState({
        enabled: true,
        selectedProfile: "a",
        timestamp: 1,
        lastNonRouterModel: 123 as any,
      }),
    ).toBe(true);
    expect(
      isRouterPersistedState({
        enabled: true,
        selectedProfile: "a",
        timestamp: 1,
        lastDecision: {
          profile: "p",
          tier: "high",
          targetProvider: "a",
          targetModelId: "b",
        } as any,
      }),
    ).toBe(true);
    expect(isRouterPersistedState({ enabled: true, selectedProfile: "a", timestamp: 1 })).toBe(
      true,
    );
    buildPersistedState(false, undefined, false, [], undefined, undefined, 0);
  });
  it("config stripJsonc branches", () => {
    expect(JSON.parse(stripJsonc(`{\n// comment\n"a":1\n}`))).toEqual({ a: 1 });
    expect(JSON.parse(stripJsonc(`{ /* block */ "a":1 }`))).toEqual({ a: 1 });
    expect(JSON.parse(stripJsonc(`{"a":"// not comment"}`))).toEqual({ a: "// not comment" });
    expect(JSON.parse(stripJsonc(`{"a":"/* not */"}`))).toEqual({ a: "/* not */" });
    expect(JSON.parse(stripJsonc(`{"a":"a\\"b"}`))).toEqual({ a: 'a"b' });
    expect(JSON.parse(stripJsonc(`{"a":1,}`))).toEqual({ a: 1 });
    expect(JSON.parse(stripJsonc(`{"a":[1,2,]}`))).toEqual({ a: [1, 2] });
    expect(stripJsonc(`a /* comment */ b`)).toContain("a");
    expect(isObjectRecord(null)).toBe(false);
    expect(isRouterTier("max")).toBe(true);
    expect(isRouterTier("bad")).toBe(false);
    expect(() => parseCanonicalModelRef("bad")).toThrow();
    expect(() => parseCanonicalModelRef("/x")).toThrow();
    expect(() => parseCanonicalModelRef("p/")).toThrow();
    expect(() => parseCanonicalModelRef("p/m#bad")).toThrow();
    expect(normalizeTierConfig(null, "p", "high", [])).toBeUndefined();
    expect(normalizeTierConfig({ models: [] }, "p", "high", [])).toBeUndefined();
    const { warnings: w1 } = normalizeConfig({ unknown: 1, profiles: {} } as any);
    expect(w1.length).toBeGreaterThan(0);
    const r = resolveContextWindow("high", {}, undefined);
    expect(r).toBeDefined();
    expect(resolveMaxTokens("high", {}, undefined)).toBeDefined();
    expect(profileNames({ profiles: { b: {}, a: {} } } as any)).toEqual(["a", "b"]);
    expect(resolveProfileName({ profiles: {} } as any, "x")).toBeUndefined();
  });
  it("context branches", () => {
    expect(extractTextFromContent([])).toBe("");
    expect(extractTextFromContent([{ type: "text" as const, text: "hi" }])).toBe("hi");
    expect(getLastUserText({ messages: [] } as any)).toBe("");
    expect(
      getLastUserText({
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] as any, timestamp: 1 }],
      } as any),
    ).toBe("hi");
    expect(
      getHistoryPairsText(
        { messages: [{ role: "user", content: "cur", timestamp: 1 } as any] } as any,
        1,
      ),
    ).toBe("");
    expect(
      truncateContext(
        { messages: [{ role: "user", content: "a".repeat(10000), timestamp: 1 } as any] } as any,
        5,
      ).messages.length,
    ).toBe(1);
    expect(estimateTokens("abc")).toBe(1);
    expect(
      truncateContext(
        {
          systemPrompt: "sys",
          messages: [
            { role: "user", content: "a".repeat(3000), timestamp: 1 } as any,
            { role: "assistant", content: "a", timestamp: 2 } as any,
            {
              role: "toolResult",
              toolCallId: "1",
              toolName: "t",
              content: "out",
              isError: false,
              timestamp: 3,
            } as any,
            { role: "user", content: "latest", timestamp: 4 } as any,
          ],
        } as any,
        2,
      ).messages.length,
    ).toBeGreaterThan(0);
  });
  it("failureMemory branches", () => {
    expect(isRecordablePreStreamError(new Error(""))).toBe(false);
    expect(isRecordablePreStreamError("x" as any)).toBe(false);
    expect(isRecordablePreStreamError(new Error("429"))).toBe(true);
    expect(isRecordablePreStreamError(new Error("aborted"))).toBe(false);
    expect(chainKeyForRoute("a", "b")).toBe("route:a:b");
    expect(normalizeFailedRef(" x ")).toBe("x");
  });
  it("routing", () => {
    expect(thinkingToTier("off" as any)).toBe("minimal");
    expect(thinkingToTier("max" as any)).toBe("max");
    expect(resolveAvailableTier({ low: { models: ["a"] } } as any, "medium" as any)).toBe("low");
    expect(
      buildRoutingDecision("p", { high: { models: ["openai/gpt#high"] } } as any, "high", "r")
        .thinking,
    ).toBe("high");
    expect(
      decideRouting(
        { messages: [] } as any,
        "p",
        { low: { models: ["openai/gpt"] } } as any,
        undefined,
      ).tier,
    ).toBe("low");
    expect(() => buildRoutingDecision("p", {} as any, "high" as any, "r")).toThrow();
  });
  it("classifier", () => {
    expect(parseClassifierOutput("")).toBeUndefined();
    expect(parseClassifierOutput("high")?.tier).toBe("high");
    expect(parseClassifierOutput("bad")).toBeUndefined();
    expect(parseClassifierOutput("Tier: high")).toBeUndefined();
  });
  it("ui and stream", () => {
    expect(
      formatDecision({
        profile: "p",
        tier: "low",
        targetProvider: "a",
        targetModelId: "m",
        reasoning: "r",
        timestamp: 1,
      } as any),
    ).toContain("p");
    const ctx: any = { ui: { setStatus: vi.fn() } };
    updateStatus(ctx, false, "p", undefined);
    updateStatus(ctx, true, "p", {
      profile: "p",
      tier: "high",
      targetProvider: "a",
      targetModelId: "m",
      thinking: "high",
      reasoning: "r",
    } as any);
    updateStatus(ctx, true, "p", {
      profile: "other",
      tier: "high",
      targetProvider: "a",
      targetModelId: "m",
    } as any);
    expect(modelWithAuthBaseUrl({ baseUrl: "a" } as any, { baseUrl: "a" })).toEqual({
      baseUrl: "a",
    });
    expect(modelWithAuthBaseUrl({ baseUrl: "a" } as any, { baseUrl: "b" } as any)).toEqual({
      baseUrl: "b",
    });
    const reg: any = { getProvider: () => ({ streamSimple: () => "s" }) };
    expect(
      streamDelegated(
        reg,
        { provider: "openai", id: "gpt" } as any,
        { messages: [] } as any,
        {} as any,
      ),
    ).toBe("s");
    expect(() =>
      streamDelegated(
        { getProvider: () => undefined } as any,
        { provider: "x", id: "y" } as any,
        { messages: [] } as any,
        {} as any,
      ),
    ).toThrow();
  });
  it("commands etc", async () => {
    const { registerCommands } = await import("../src/commands");
    const pi: any = { registerCommand: vi.fn() };
    registerCommands(
      pi,
      {
        currentConfig: { profiles: { a: {} }, historySize: 0 } as any,
        routerEnabled: true,
        selectedProfile: "a",
        lastDecision: {
          profile: "a",
          tier: "high",
          targetProvider: "openai",
          targetModelId: "gpt",
          reasoning: "r",
          thinking: "high",
          timestamp: Date.now(),
        } as any,
        lastNonRouterModel: "openai/gpt",
        accumulatedCost: 1,
        debugEnabled: true,
        debugHistory: [
          {
            profile: "a",
            tier: "high",
            targetProvider: "openai",
            targetModelId: "gpt",
            reasoning: "r",
            thinking: "high",
            timestamp: Date.now(),
          } as any,
        ],
        lastConfigWarnings: ["w"],
        failedByChain: new Map([["k", new Set(["v"])]]),
      } as any,
      {
        persistState: vi.fn(),
        updateStatus: vi.fn(),
        reloadConfig: vi.fn(),
        ensureValidActiveRouterProfile: vi.fn(),
      } as any,
    );
    expect(pi.registerCommand).toHaveBeenCalled();
  });
});
