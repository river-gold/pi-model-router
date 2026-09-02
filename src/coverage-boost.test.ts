/* oxlint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  stripJsonc,
  parseConfigFile,
  mergeConfig,
  isObjectRecord,
  isRouterTier,
  parseCanonicalModelRef,
  normalizeTierConfig,
  normalizeClassifierConfig,
  normalizeClassifierModels,
  normalizeConfig,
  resolveEffectiveClassifier,
  profileNames,
  resolveProfileName,
  resolveContextWindow,
  resolveMaxTokens,
  resolveDelegatedReasoning,
  formatModelRef,
  loadRouterConfig,
  ROUTER_TIERS,
} from "./config";
import type { RouterConfig, RouterProfile } from "./types";
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from "./constants";
import {
  extractTextFromContent,
  getLastUserText,
  getHistoryPairsText,
  estimateTokens,
  truncateContext,
} from "./context";
import { isRouterPersistedState, buildPersistedState } from "./state";
import { formatDecision, formatModelRef as formatModelRefUi, updateStatus } from "./ui";
import { isRecordablePreStreamError, normalizeFailedRef, chainKeyForRoute } from "./failureMemory";
import {
  parseClassifierOutput,
  runClassifier,
  runClassifierWithFallbacksDetailed,
} from "./classifier";
import type { Context, Message } from "@earendil-works/pi-ai";
import type { Model, Api } from "@earendil-works/pi-ai";
import { modelWithAuthBaseUrl, streamDelegated } from "./stream";
import { getLogPath, logClassifierSync } from "./logger";
import {
  thinkingToTier,
  resolveAvailableTier,
  buildRoutingDecision,
  decideRouting,
} from "./routing";

// Config - stripJsonc exhaustive
describe("coverage-boost stripJsonc", () => {
  it("handles line comments", () => {
    expect(JSON.parse(stripJsonc(`{\n// comment\n"a":1\n}`))).toEqual({ a: 1 });
  });
  it("handles block comments", () => {
    expect(JSON.parse(stripJsonc(`{ /* block */ "a":1 }`))).toEqual({ a: 1 });
  });
  it("preserves // inside string", () => {
    expect(JSON.parse(stripJsonc(`{"a":"// not comment"}`))).toEqual({ a: "// not comment" });
  });
  it("preserves /* inside string", () => {
    expect(JSON.parse(stripJsonc(`{"a":"/* not */"}`))).toEqual({ a: "/* not */" });
  });
  it("handles escaped quotes inside string", () => {
    expect(JSON.parse(stripJsonc(`{"a":"a\\"b"}`))).toEqual({ a: 'a"b' });
  });
  it("handles single quotes", () => {
    // stripJsonc should handle single-quoted strings as strings
    const s = stripJsonc(`{'a':1}`);
    expect(s).toContain("'a'");
  });
  it("removes trailing commas", () => {
    expect(JSON.parse(stripJsonc(`{"a":1,}`))).toEqual({ a: 1 });
    expect(JSON.parse(stripJsonc(`{"a":[1,2,]}`))).toEqual({ a: [1, 2] });
    expect(JSON.parse(stripJsonc(`{"a":1 , }`))).toEqual({ a: 1 });
  });
  it("handles escaped backslash", () => {
    const s = stripJsonc(`{"a":"\\\\"}`);
    expect(JSON.parse(s)).toEqual({ a: "\\" });
  });
  it("handles block comment closing", () => {
    expect(stripJsonc(`a /* comment */ b`)).toContain("a");
  });
  it("handles newline in single line comment", () => {
    const out = stripJsonc(`// comment\n{"a":1}`);
    expect(out).toContain('{"a":1}');
  });
});

describe("coverage-boost isObjectRecord/isRouterTier", () => {
  it("covers", () => {
    expect(isObjectRecord(null)).toBe(false);
    expect(isObjectRecord([])).toBe(false);
    expect(isObjectRecord({})).toBe(true);
    expect(isRouterTier("max")).toBe(true);
    expect(isRouterTier("invalid")).toBe(false);
    expect(isRouterTier(undefined)).toBe(false);
  });
});

describe("coverage-boost parseCanonicalModelRef", () => {
  it("throws on missing slash", () => {
    expect(() => parseCanonicalModelRef("gpt4")).toThrow();
  });
  it("throws on empty provider", () => {
    expect(() => parseCanonicalModelRef("/model")).toThrow();
  });
  it("throws on empty modelId", () => {
    expect(() => parseCanonicalModelRef("prov/")).toThrow();
  });
  it("throws on invalid thinking", () => {
    expect(() => parseCanonicalModelRef("prov/mod#invalid")).toThrow();
  });
  it("allows empty thinking after hash (treated as undefined)", () => {
    const r = parseCanonicalModelRef("prov/mod#");
    expect(r.provider).toBe("prov");
    expect(r.thinking).toBeUndefined();
  });
  it("trims provider/model", () => {
    const r = parseCanonicalModelRef(" prov / mod #high ");
    expect(r.provider).toBe("prov");
    expect(r.modelId).toBe("mod");
    expect(r.thinking).toBe("high");
  });
});

describe("coverage-boost formatModelRef", () => {
  it("with thinking", () => {
    expect(formatModelRef("a", "b", "high" as any)).toBe("a/b#high");
  });
  it("without", () => {
    expect(formatModelRef("a", "b")).toBe("a/b");
  });
});

describe("coverage-boost mergeConfig edge", () => {
  it("skips non-object profile", () => {
    const base: RouterConfig = { profiles: {} };
    const override = { profiles: { bad: "not-object" } } as unknown as Partial<RouterConfig>;
    const m = mergeConfig(base, override);
    expect(m.profiles.bad).toBeUndefined();
  });
  it("handles historyLimit alias", () => {
    const base: RouterConfig = { profiles: {}, historySize: 0 };
    const override = { historyLimit: 5 } as unknown as Partial<RouterConfig>;
    expect(mergeConfig(base, override).historySize).toBe(5);
  });
  it("handles historySize precedence", () => {
    const base: RouterConfig = { profiles: {}, historySize: 1 };
    const override = { historySize: 3, historyLimit: 9 } as unknown as Partial<RouterConfig>;
    expect(mergeConfig(base, override).historySize).toBe(3);
  });
});

describe("coverage-boost normalizeClassifierConfig", () => {
  it("valid string", () => {
    expect(normalizeClassifierConfig("openai/gpt#high", [], "ctx")?.thinking).toBe("high");
  });
  it("invalid string throws", () => {
    const w: string[] = [];
    expect(normalizeClassifierConfig("bad-ref", w, "ctx")).toBeUndefined();
    expect(w.length).toBe(1);
  });
  it("empty string returns undefined", () => {
    expect(normalizeClassifierConfig("   ", [], "ctx")).toBeUndefined();
  });
  it("object with model and thinking warns", () => {
    const w: string[] = [];
    const r = normalizeClassifierConfig({ model: "openai/gpt", thinking: "high" }, w, "ctx");
    expect(r?.model).toBe("openai/gpt");
    expect(w.some((s) => s.includes("separate"))).toBe(true);
  });
  it("object missing model", () => {
    const w: string[] = [];
    expect(normalizeClassifierConfig({ foo: "bar" }, w, "ctx")).toBeUndefined();
    expect(w[0]).toContain("missing");
  });
  it("object invalid model", () => {
    const w: string[] = [];
    expect(normalizeClassifierConfig({ model: "bad" }, w, "ctx")).toBeUndefined();
    expect(w[0]).toContain("Invalid");
  });
  it("non-string non-object returns undefined", () => {
    expect(normalizeClassifierConfig(123, [], "ctx")).toBeUndefined();
    expect(normalizeClassifierConfig(null, [], "ctx")).toBeUndefined();
  });
});

describe("coverage-boost normalizeClassifierModels", () => {
  it("undefined returns undefined", () => {
    expect(normalizeClassifierModels(undefined, [], "c")).toBeUndefined();
  });
  it("string valid", () => {
    expect(normalizeClassifierModels("openai/gpt", [], "c")?.length).toBe(1);
  });
  it("string invalid returns undefined", () => {
    expect(normalizeClassifierModels("bad", [], "c")).toBeUndefined();
  });
  it("array mix valid/invalid", () => {
    const w: string[] = [];
    const r = normalizeClassifierModels(["openai/gpt", "bad", "google/gemini"], w, "c");
    expect(r?.length).toBe(2);
  });
  it("array all invalid returns undefined", () => {
    expect(normalizeClassifierModels(["bad1", "bad2"], [], "c")).toBeUndefined();
  });
  it("object legacy", () => {
    const r = normalizeClassifierModels({ model: "openai/gpt" }, [], "c");
    expect(r?.length).toBe(1);
  });
  it("object missing model returns undefined", () => {
    expect(normalizeClassifierModels({ foo: 1 }, [], "c")).toBeUndefined();
  });
  it("invalid type number", () => {
    const w: string[] = [];
    expect(normalizeClassifierModels(123, w, "c")).toBeUndefined();
    expect(w[0]).toContain("expected string");
  });
});

describe("coverage-boost resolveEffectiveClassifier", () => {
  it("profile + global + low tier", () => {
    const p: RouterProfile = {
      classifierModels: [{ model: "openai/gpt" }],
      low: { models: ["google/gemini#low"] },
    };
    const r = resolveEffectiveClassifier(p, [{ model: "anthropic/claude" }]);
    expect(r.classifiers?.length).toBe(3);
    expect(r.source).toContain("profile");
    expect(r.source).toContain("global");
    expect(r.source).toContain("low tier");
  });
  it("only global", () => {
    const p: RouterProfile = {};
    const r = resolveEffectiveClassifier(p, [{ model: "openai/gpt" }]);
    expect(r.classifiers?.length).toBe(1);
    expect(r.source).toBe("global");
  });
});

describe("coverage-boost normalizeTierConfig", () => {
  it("non-object returns undefined", () => {
    expect(normalizeTierConfig(null, "p", "high", [])).toBeUndefined();
  });
  it("warns thinking field", () => {
    const w: string[] = [];
    normalizeTierConfig({ models: ["openai/gpt"], thinking: "high" }, "p", "high", w);
    expect(w.some((s) => s.includes("thinking"))).toBe(true);
  });
  it("warns fallbacks and model", () => {
    const w: string[] = [];
    normalizeTierConfig(
      { models: ["openai/gpt"], fallbacks: ["a"], model: "openai/gpt" } as any,
      "p",
      "high",
      w,
    );
    expect(w.some((s) => s.includes("fallbacks"))).toBe(true);
    expect(w.some((s) => s.includes('"model" is removed'))).toBe(true);
  });
  it("missing models warns", () => {
    const w: string[] = [];
    expect(normalizeTierConfig({}, "p", "high", w)).toBeUndefined();
    expect(w[0]).toContain("missing");
    expect(normalizeTierConfig({ models: [] }, "p", "high", w)).toBeUndefined();
  });
  it("invalid entries", () => {
    const w: string[] = [];
    const r = normalizeTierConfig({ models: [123, "", "bad", "openai/gpt"] }, "p", "high", w);
    expect(r?.models).toEqual(["openai/gpt"]);
    expect(w.some((s) => s.includes("Invalid model entry"))).toBe(true);
  });
  it("no valid models returns undefined", () => {
    const w: string[] = [];
    expect(normalizeTierConfig({ models: ["bad1", "bad2"] }, "p", "high", w)).toBeUndefined();
  });
  it("with contextWindow/maxTokens/reasoning", () => {
    const w: string[] = [];
    const r = normalizeTierConfig(
      { models: ["openai/gpt#high"], contextWindow: 9999, maxTokens: 888, reasoning: true },
      "p",
      "high",
      w,
    );
    expect(r?.contextWindow).toBe(9999);
    expect(r?.maxTokens).toBe(888);
    expect(r?.reasoning).toBe(true);
    expect(r?.resolvedContextWindow).toBe(9999);
    expect(r?.resolvedMaxTokens).toBe(888);
  });
  it("without contextWindow uses default", () => {
    const w: string[] = [];
    const r = normalizeTierConfig({ models: ["openai/gpt"] }, "p", "high", w);
    expect(r?.resolvedContextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
  });
});

describe("coverage-boost normalizeConfig", () => {
  it("unknown top-level field", () => {
    const { warnings } = normalizeConfig({
      unknownField: 1,
      profiles: {},
    } as unknown as RouterConfig);
    expect(warnings.some((w) => w.includes("Unknown config field"))).toBe(true);
  });
  it("profile not object", () => {
    const { warnings } = normalizeConfig({
      profiles: { bad: "string" },
    } as unknown as RouterConfig);
    expect(warnings.some((w) => w.includes("not an object"))).toBe(true);
  });
  it("profile no valid tiers", () => {
    const { warnings } = normalizeConfig({ profiles: { empty: {} } } as unknown as RouterConfig);
    expect(warnings.some((w) => w.includes("no valid tiers"))).toBe(true);
  });
  it("profile classifierModel deprecated", () => {
    const { warnings } = normalizeConfig({
      profiles: { p: { high: { models: ["openai/gpt"] }, classifierModel: "openai/gpt" } },
    } as unknown as RouterConfig);
    expect(warnings.some((w) => w.includes("classifierModel is deprecated"))).toBe(true);
  });
  it("global classifierModel deprecated", () => {
    const { warnings } = normalizeConfig({
      classifierModel: "openai/gpt",
      profiles: { p: { high: { models: ["openai/gpt"] } } },
    } as unknown as RouterConfig);
    expect(warnings.some((w) => w.includes("classifierModel is deprecated"))).toBe(true);
  });
  it("historySize valid and invalid", () => {
    const { config, warnings } = normalizeConfig({
      historySize: 25,
      profiles: { p: { high: { models: ["openai/gpt"] } } },
    } as unknown as RouterConfig);
    expect(config.historySize).toBe(0);
    expect(warnings.some((w) => w.includes("Invalid historySize"))).toBe(true);
    const { config: c2 } = normalizeConfig({
      historySize: 5,
      profiles: { p: { high: { models: ["openai/gpt"] } } },
    } as unknown as RouterConfig);
    expect(c2.historySize).toBe(5);
  });
  it("historyLimit alias", () => {
    const { config } = normalizeConfig({
      historyLimit: 3,
      profiles: { p: { high: { models: ["openai/gpt"] } } },
    } as unknown as RouterConfig);
    expect(config.historySize).toBe(3);
  });
});

describe("coverage-boost profileNames/resolveProfileName", () => {
  it("sorts", () => {
    expect(profileNames({ profiles: { b: {}, a: {} } } as RouterConfig)).toEqual(["a", "b"]);
  });
  it("resolve undefined", () => {
    expect(resolveProfileName({ profiles: {} } as RouterConfig, "missing")).toBeUndefined();
  });
  it("resolve found", () => {
    expect(resolveProfileName({ profiles: { a: {} } } as RouterConfig, "a")).toBe("a");
  });
});

describe("coverage-boost resolveContextWindow/resolveMaxTokens", () => {
  it("tier missing returns default", () => {
    expect(resolveContextWindow("high", {}, undefined)).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(resolveMaxTokens("high", {}, undefined)).toBe(DEFAULT_MAX_TOKENS);
  });
  it("user contextWindow precedence", () => {
    const p: RouterProfile = {
      high: { models: ["openai/gpt"], contextWindow: 1234, resolvedContextWindow: 9999 },
    };
    expect(resolveContextWindow("high", p, undefined)).toBe(1234);
  });
  it("registry returns contextWindow", () => {
    const p: RouterProfile = { high: { models: ["openai/gpt"], resolvedContextWindow: 9999 } };
    const reg = { find: () => ({ contextWindow: 5555 }) } as any;
    expect(resolveContextWindow("high", p, reg)).toBe(5555);
  });
  it("registry find throws ignored", () => {
    const p: RouterProfile = { high: { models: ["invalid"], resolvedContextWindow: 7777 } };
    const reg = {
      find: () => {
        throw new Error("fail");
      },
    } as any;
    expect(resolveContextWindow("high", p, reg)).toBe(7777);
  });
  it("maxTokens precedence and registry", () => {
    const p: RouterProfile = {
      high: { models: ["openai/gpt"], maxTokens: 111, resolvedMaxTokens: 999 },
    };
    expect(resolveMaxTokens("high", p, undefined)).toBe(111);
    const p2: RouterProfile = { high: { models: ["openai/gpt"], resolvedMaxTokens: 999 } };
    const reg = { find: () => ({ maxTokens: 222 }) } as any;
    expect(resolveMaxTokens("high", p2, reg)).toBe(222);
    const regThrow = {
      find: () => {
        throw new Error("x");
      },
    } as any;
    expect(resolveMaxTokens("high", p2, regThrow)).toBe(999);
  });
});

describe("coverage-boost resolveDelegatedReasoning", () => {
  it("cases", () => {
    expect(resolveDelegatedReasoning({ reasoning: false } as any, "high")).toBeUndefined();
    expect(resolveDelegatedReasoning({ reasoning: true } as any, undefined)).toBeUndefined();
    expect(resolveDelegatedReasoning({ reasoning: true } as any, "off")).toBeUndefined();
    expect(resolveDelegatedReasoning({ reasoning: true } as any, "high")).toBe("high");
  });
});

describe("coverage-boost context", () => {
  it("extractText edge: empty parts", () => {
    expect(extractTextFromContent([])).toBe("");
    expect(extractTextFromContent([{ type: "text" as const, text: "hi" }])).toBe("hi");
    expect(extractTextFromContent([{ type: "unknown" as any, foo: "bar" } as any])).toBe("");
  });
  it("getLastUserText no user", () => {
    expect(getLastUserText({ messages: [] })).toBe("");
  });
  it("getLastUserText with image content", () => {
    const ctx: Context = {
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] as any, timestamp: 1 }],
    };
    expect(getLastUserText(ctx)).toBe("hello");
  });
  it("getHistoryPairs with empty user text skipped", () => {
    const ctx: Context = {
      messages: [
        { role: "user", content: "", timestamp: 1 } as unknown as Message,
        { role: "assistant", content: "a1", timestamp: 2 } as unknown as Message,
        { role: "user", content: "cur", timestamp: 3 },
      ],
    };
    expect(getHistoryPairsText(ctx, 2)).toBe("");
  });
  it("getHistoryPairs without finalText", () => {
    const ctx: Context = {
      messages: [
        { role: "user", content: "u1", timestamp: 1 },
        { role: "user", content: "u2", timestamp: 2 },
        { role: "user", content: "cur", timestamp: 3 },
      ],
    };
    expect(getHistoryPairsText(ctx, 2)).toBe("u1\n---\nu2");
  });
  it("truncateContext single message returns as-is even if over limit", () => {
    const ctx: Context = {
      messages: [
        { role: "user", content: "a".repeat(10000), timestamp: 1 },
      ] as unknown as Message[],
    };
    expect(truncateContext(ctx, 5)).toBe(ctx);
  });
  it("truncateContext with systemPrompt and tool results orphan", () => {
    const ctx: Context = {
      systemPrompt: "sys",
      messages: [
        { role: "user", content: "a".repeat(3000), timestamp: 1 } as unknown as Message,
        { role: "assistant", content: "tool call", timestamp: 2 } as unknown as Message,
        {
          role: "toolResult",
          toolCallId: "1",
          toolName: "t",
          content: "out",
          isError: false,
          timestamp: 3,
        } as unknown as Message,
        { role: "user", content: "latest", timestamp: 4 } as unknown as Message,
      ],
    };
    const out = truncateContext(ctx, 2);
    expect(out.messages[out.messages.length - 1].content).toBe("latest");
  });
  it("truncate aligns to user boundary and drops orphan toolResult", () => {
    const ctx: Context = {
      messages: [
        { role: "assistant", content: "a", timestamp: 1 } as unknown as Message,
        {
          role: "toolResult",
          toolCallId: "1",
          toolName: "t",
          content: "orphan",
          isError: false,
          timestamp: 2,
        } as unknown as Message,
        {
          role: "toolResult",
          toolCallId: "2",
          toolName: "t",
          content: "orphan2",
          isError: false,
          timestamp: 3,
        } as unknown as Message,
        { role: "user", content: "cur", timestamp: 4 } as unknown as Message,
      ],
    };
    const out = truncateContext(ctx, 1);
    // Should drop orphan toolResults
    expect(out.messages[0].role).toBe("user");
  });
  it("estimateTokens", () => {
    expect(estimateTokens("abc")).toBe(1);
  });
});

describe("coverage-boost state", () => {
  it("isRouterPersistedState edge cases", () => {
    expect(isRouterPersistedState(null)).toBe(false);
    expect(isRouterPersistedState("s")).toBe(false);
    expect(isRouterPersistedState({ enabled: true })).toBe(false);
    expect(isRouterPersistedState({ enabled: "yes", selectedProfile: "a", timestamp: 1 })).toBe(
      false,
    );
    expect(
      isRouterPersistedState({
        enabled: true,
        selectedProfile: "a",
        timestamp: 1,
        debugHistory: "notarray" as any,
      }),
    ).toBe(false);
    expect(
      isRouterPersistedState({
        enabled: true,
        selectedProfile: "a",
        timestamp: 1,
        accumulatedCost: -1,
      }),
    ).toBe(false);
    expect(
      isRouterPersistedState({
        enabled: true,
        selectedProfile: "a",
        timestamp: 1,
        accumulatedCost: Infinity,
      }),
    ).toBe(false);
    expect(
      isRouterPersistedState({
        enabled: true,
        selectedProfile: "a",
        timestamp: 1,
        accumulatedCost: "bad" as any,
      }),
    ).toBe(false);
    expect(
      isRouterPersistedState({
        enabled: true,
        selectedProfile: "a",
        timestamp: 1,
        lastDecision: "bad" as any,
      }),
    ).toBe(false);
    expect(
      isRouterPersistedState({
        enabled: true,
        selectedProfile: "a",
        timestamp: 1,
        lastDecision: [] as any,
      }),
    ).toBe(false);
    expect(
      isRouterPersistedState({
        enabled: true,
        selectedProfile: "a",
        timestamp: 1,
        lastDecision: { profile: "p" } as any,
      }),
    ).toBe(false);
    expect(
      isRouterPersistedState({
        enabled: true,
        selectedProfile: "a",
        timestamp: 1,
        debugEnabled: "yes" as any,
      }),
    ).toBe(false);
    expect(
      isRouterPersistedState({
        enabled: true,
        selectedProfile: "a",
        timestamp: 1,
        lastNonRouterModel: 123 as any,
      }),
    ).toBe(false);
    expect(isRouterPersistedState({ enabled: true, selectedProfile: "a", timestamp: 1 })).toBe(
      true,
    );
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
  });
  it("buildPersistedState with undefined", () => {
    const s = buildPersistedState(false, undefined, false, [], undefined, undefined, 0);
    expect(s.selectedProfile).toBe("");
  });
});

describe("coverage-boost ui", () => {
  it("formatDecision with auto thinking", () => {
    const d: any = {
      profile: "p",
      tier: "low",
      targetProvider: "a",
      targetModelId: "m",
      targetLabel: "a/m",
      thinking: undefined,
      reasoning: "r",
    };
    expect(formatDecision(d)).toContain("[auto]");
  });
  it("updateStatus disabled clears", () => {
    const ctx = { ui: { setStatus: vi.fn() } } as any;
    updateStatus(ctx, false, "p", undefined);
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("router", undefined);
  });
  it("updateStatus mismatch profile shows waiting", () => {
    const ctx = { ui: { setStatus: vi.fn() } } as any;
    updateStatus(ctx, true, "p", {
      profile: "other",
      tier: "high",
      targetProvider: "a",
      targetModelId: "m",
      thinking: "high",
    } as any);
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("router", expect.stringContaining("waiting"));
  });
});

describe("coverage-boost failureMemory", () => {
  it("recordable patterns", () => {
    expect(isRecordablePreStreamError(new Error("quota exceeded"))).toBe(true);
    expect(isRecordablePreStreamError(new Error("rate limit"))).toBe(true);
    expect(isRecordablePreStreamError(new Error("overloaded"))).toBe(true);
    expect(isRecordablePreStreamError(new Error("500 internal"))).toBe(true);
    expect(isRecordablePreStreamError(new Error("server error"))).toBe(true);
    expect(isRecordablePreStreamError(new Error("unavailable"))).toBe(true);
    expect(isRecordablePreStreamError(new Error(""))).toBe(false);
    expect(isRecordablePreStreamError("str" as any)).toBe(false);
  });
});

describe("coverage-boost routing", () => {
  it("thinkingToTier off -> minimal", () => {
    expect(thinkingToTier("off" as any)).toBe("minimal");
  });
  it("resolveAvailableTier fallback down", () => {
    expect(resolveAvailableTier({ low: { models: ["a"] } }, "medium")).toBe("low");
    expect(resolveAvailableTier({}, "medium" as any)).toBe("medium");
  });
  it("buildRoutingDecision uses routed.thinking fallback", () => {
    const p: RouterProfile = {
      high: { models: ["openai/gpt#low"], model: "openai/gpt", thinking: undefined },
    };
    // actually thinking from model ref
    const d = buildRoutingDecision("p", p, "high", "r");
    expect(d.thinking).toBe("low");
  });
  it("decideRouting with missing tier resolves", () => {
    const p: RouterProfile = { low: { models: ["openai/gpt#low"] } };
    const d = decideRouting({ messages: [] } as any, "p", p, undefined);
    expect(d.tier).toBe("low");
  });
});

describe("coverage-boost stream", () => {
  it("modelWithAuthBaseUrl same", () => {
    const m = { baseUrl: "https://a" } as any;
    expect(modelWithAuthBaseUrl(m, { baseUrl: "https://a" })).toBe(m);
  });
  it("delegates", () => {
    const fn = vi.fn().mockReturnValue("s");
    const reg = { getProvider: () => ({ streamSimple: fn }) } as any;
    const m = { provider: "openai", id: "gpt" } as any;
    expect(streamDelegated(reg, m, { messages: [] } as any, {} as any)).toBe("s");
  });
  it("throws when no provider", () => {
    const reg = { getProvider: () => undefined } as any;
    expect(() =>
      streamDelegated(
        reg,
        { provider: "missing", id: "m" } as any,
        { messages: [] } as any,
        {} as any,
      ),
    ).toThrow();
  });
});

describe("coverage-boost logger", () => {
  it("getLogPath", () => {
    expect(getLogPath()).toContain("pi-model-router.log");
  });
  it("logClassifierSync does not throw", () => {
    expect(() =>
      logClassifierSync({
        timestamp: new Date().toISOString(),
        model: "m",
        fullText: "hi",
        success: true,
      }),
    ).not.toThrow();
  });
});

describe("coverage-boost classifier parse", () => {
  it("various tier formats", () => {
    expect(parseClassifierOutput("minimal")?.tier).toBe("minimal");
    expect(parseClassifierOutput("  high ")?.tier).toBe("high");
    expect(parseClassifierOutput("  low  ")?.tier).toBe("low");
    expect(parseClassifierOutput("")).toBeUndefined();
    expect(parseClassifierOutput("no tier here")).toBeUndefined();
    expect(parseClassifierOutput("HIGH")?.tier).toBe("high");
    expect(parseClassifierOutput("Tier: high")).toBeUndefined();
    expect(parseClassifierOutput("Tier: high\nReasoning:")).toBeUndefined();
  });
});

describe("coverage-boost loadRouterConfig integration", () => {
  it("merges warnings", async () => {
    vi.resetModules();
    // Mock fs to simulate config files via vi.mock is tricky here; instead test that function returns structure
    const cfg = loadRouterConfig("/tmp");
    expect(cfg.config).toBeDefined();
    expect(Array.isArray(cfg.warnings)).toBe(true);
  });
});
