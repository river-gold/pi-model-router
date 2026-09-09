import { describe, expect, it, vi } from "vitest";
import {
  mergeTier,
  resolveAvailableTier as resolveAvailableTierFromConfig,
} from "../../src/config/tier";
import { resolveAvailableTier as resolveAvailableTierFromRouting } from "../../src/routing";
import { normalizeConfig } from "../../src/config/normalize";
import { resolveProfileTierRefs } from "../../src/config/ref";
import type { RouterConfig } from "../../src/types";

const makeProfiles = (): Record<string, Record<string, unknown>> => ({
  auto: {
    high: { models: ["xai/grok-4.6#high"] },
    medium: { ref: "copilot#high" },
    low: { models: ["ollama-cloud/deepseek-v4-flash:0731#low"] },
  },
  copilot: {
    high: { models: ["github-copilot/gpt-5.6-sol#high"] },
    medium: { models: ["github-copilot/gpt-5.6-luna#high"] },
  },
});

describe("tier ref 치환을 검증함", () => {
  describe("resolveProfileTierRefs 동작을 검증함", () => {
    it("ref를 대상 tier 값으로 치환함을 검증함", () => {
      const profiles = makeProfiles();
      const warnings: string[] = [];
      resolveProfileTierRefs(profiles, warnings);
      expect(profiles.auto!.medium).toEqual({ models: ["github-copilot/gpt-5.6-sol#high"] });
      expect(warnings).toEqual([]);
    });
    it("object가 아닌 profile은 건너뜀을 검증함", () => {
      const profiles = { bad: "not-object" } as unknown as Record<string, Record<string, unknown>>;
      const warnings: string[] = [];
      resolveProfileTierRefs(profiles, warnings);
      expect(warnings).toEqual([]);
    });
    it("structuredClone이 없으면 JSON 복사로 치환함을 검증함", () => {
      vi.stubGlobal("structuredClone", undefined);
      try {
        const profiles = makeProfiles();
        resolveProfileTierRefs(profiles, []);
        expect(profiles.auto!.medium).toEqual({ models: ["github-copilot/gpt-5.6-sol#high"] });
      } finally {
        vi.unstubAllGlobals();
      }
    });
    it("deep copy로 치환되어 원본과 독립적임을 검증함", () => {
      const profiles = makeProfiles();
      resolveProfileTierRefs(profiles, []);
      (profiles.auto!.medium as Record<string, unknown[]>).models!.push("x/y");
      expect(profiles.copilot!.high).toEqual({ models: ["github-copilot/gpt-5.6-sol#high"] });
    });
    it("ref와 다른 키가 함께 있어도 통째로 치환함을 검증함", () => {
      const profiles = makeProfiles();
      profiles.auto!.medium = { ref: "copilot#high", models: ["x/y"] };
      resolveProfileTierRefs(profiles, []);
      expect(profiles.auto!.medium).toEqual({ models: ["github-copilot/gpt-5.6-sol#high"] });
    });
    it("잘못된 ref 형식은 tier를 비활성화함을 검증함", () => {
      const cases = ["copilot", "#high", "copilot#", "copilot#unknown", "", "a#b#c"];
      for (const ref of cases) {
        const profiles = makeProfiles();
        profiles.auto!.medium = { ref };
        const warnings: string[] = [];
        resolveProfileTierRefs(profiles, warnings);
        expect(profiles.auto!.medium).toBeUndefined();
        expect(warnings.some((w) => w.includes("invalid ref"))).toBe(true);
      }
    });
    it("존재하지 않는 대상은 tier를 비활성화함을 검증함", () => {
      const profiles = makeProfiles();
      profiles.auto!.medium = { ref: "missing#high" };
      const warnings: string[] = [];
      resolveProfileTierRefs(profiles, warnings);
      expect(profiles.auto!.medium).toBeUndefined();
      expect(warnings.some((w) => w.includes("not found"))).toBe(true);
    });
    it("자기참조는 tier를 비활성화함을 검증함", () => {
      const profiles = makeProfiles();
      profiles.auto!.medium = { ref: "auto#medium" };
      const warnings: string[] = [];
      resolveProfileTierRefs(profiles, warnings);
      expect(profiles.auto!.medium).toBeUndefined();
      expect(warnings.some((w) => w.includes("itself"))).toBe(true);
    });
    it("대상이 또 ref면 해결하지 않고 비활성화함을 검증함", () => {
      const profiles: Record<string, Record<string, unknown>> = {
        a: { medium: { ref: "b#high" } },
        b: { high: { ref: "c#high" } },
        c: { high: { models: ["openai/gpt-4o"] } },
      };
      const warnings: string[] = [];
      resolveProfileTierRefs(profiles, warnings);
      expect(profiles.a!.medium).toBeUndefined();
      expect(warnings.some((w) => w.includes("itself a ref"))).toBe(true);
      expect(profiles.b!.high).toEqual({ models: ["openai/gpt-4o"] });
    });
    it("ref가 없는 tier는 그대로 둠을 검증함", () => {
      const profiles = makeProfiles();
      const warnings: string[] = [];
      resolveProfileTierRefs(profiles, warnings);
      expect(profiles.auto!.high).toEqual({ models: ["xai/grok-4.6#high"] });
      expect(profiles.copilot!.medium).toEqual({ models: ["github-copilot/gpt-5.6-luna#high"] });
    });
  });

  describe("normalizeConfig 통합을 검증함", () => {
    it("auto.medium ref가 copilot.high 값으로 로드됨을 검증함", () => {
      const { config, warnings } = normalizeConfig({
        profiles: {
          auto: {
            high: { models: ["xai/grok-4.6#high"] },
            medium: { ref: "copilot#high" },
            low: { models: ["ollama-cloud/deepseek-v4-flash:0731#low"] },
          },
          copilot: {
            high: { models: ["github-copilot/gpt-5.6-sol#high"] },
            medium: { models: ["github-copilot/gpt-5.6-luna#high"] },
          },
        },
      } as unknown as RouterConfig);
      expect(warnings).toEqual([]);
      expect(config.profiles.auto!.medium?.models).toEqual(["github-copilot/gpt-5.6-sol#high"]);
      expect(config.profiles.auto!.high?.models).toEqual(["xai/grok-4.6#high"]);
      expect("ref" in (config.profiles.auto!.medium as unknown as Record<string, unknown>)).toBe(
        false,
      );
    });
    it("무효한 ref tier는 제외하고 유효 tier는 유지함을 검증함", () => {
      const { config, warnings } = normalizeConfig({
        profiles: {
          auto: {
            medium: { ref: "missing#high" },
            low: { models: ["ollama-cloud/deepseek-v4-flash:0731#low"] },
          },
        },
      } as unknown as RouterConfig);
      expect(warnings.some((w) => w.includes("not found"))).toBe(true);
      expect(config.profiles.auto!.medium).toBeUndefined();
      expect(config.profiles.auto!.low?.models).toEqual([
        "ollama-cloud/deepseek-v4-flash:0731#low",
      ]);
    });
    it("ref만 있고 모두 실패한 profile은 건너뜀을 검증함", () => {
      const { config, warnings } = normalizeConfig({
        profiles: { auto: { medium: { ref: "missing#high" } } },
      } as unknown as RouterConfig);
      expect(config.profiles.auto).toBeUndefined();
      expect(warnings.some((w) => w.includes("has no valid tiers"))).toBe(true);
    });
  });

  describe("mergeTier ref 우선 병합을 검증함", () => {
    it("override ref는 기존 models와 섞이지 않음을 검증함", () => {
      const merged = mergeTier({ models: ["openai/a"] } as any, { ref: "copilot#high" } as any);
      expect(merged).toEqual({ ref: "copilot#high" });
    });
  });

  describe("가까운 tier 폴백을 검증함", () => {
    it("라우팅과 같은 함수를 공유함을 검증함", () => {
      expect(resolveAvailableTierFromConfig).toBe(resolveAvailableTierFromRouting);
    });
    it("없는 tier는 위쪽 가까운 tier로 치환함을 검증함", () => {
      const profiles: Record<string, Record<string, unknown>> = {
        auto: { medium: { ref: "copilot#low" } },
        copilot: { high: { models: ["github-copilot/gpt-5.6-sol#high"] } },
      };
      const warnings: string[] = [];
      resolveProfileTierRefs(profiles, warnings);
      expect(profiles.auto!.medium).toEqual({ models: ["github-copilot/gpt-5.6-sol#high"] });
      expect(warnings.some((w) => w.includes('Resolved to nearby "copilot#high"'))).toBe(true);
    });
    it("위쪽이 없으면 아래쪽 가까운 tier로 치환함을 검증함", () => {
      const profiles: Record<string, Record<string, unknown>> = {
        auto: { medium: { ref: "copilot#high" } },
        copilot: { low: { models: ["ollama-cloud/deepseek-v4-flash:0731#low"] } },
      };
      resolveProfileTierRefs(profiles, []);
      expect(profiles.auto!.medium).toEqual({
        models: ["ollama-cloud/deepseek-v4-flash:0731#low"],
      });
    });
    it("가까운 tier 탐색에서 ref tier는 제외함을 검증함", () => {
      const profiles: Record<string, Record<string, unknown>> = {
        auto: { medium: { ref: "copilot#high" } },
        copilot: {
          low: { ref: "other#low" },
          minimal: { models: ["openai/min"] },
        },
        other: { low: { models: ["openai/other"] } },
      };
      resolveProfileTierRefs(profiles, []);
      expect(profiles.auto!.medium).toEqual({ models: ["openai/min"] });
    });
    it("대상 profile에 구체 tier가 없으면 비활성화함을 검증함", () => {
      const profiles: Record<string, Record<string, unknown>> = {
        auto: { medium: { ref: "copilot#high" } },
        copilot: {},
      };
      const warnings: string[] = [];
      resolveProfileTierRefs(profiles, warnings);
      expect(profiles.auto!.medium).toBeUndefined();
      expect(warnings.some((w) => w.includes("Tier disabled"))).toBe(true);
    });
    it("normalizeConfig 통합에서 가까운 tier로 로드됨을 검증함", () => {
      const { config, warnings } = normalizeConfig({
        profiles: {
          auto: { medium: { ref: "copilot#high" } },
          copilot: { low: { models: ["ollama-cloud/deepseek-v4-flash:0731#low"] } },
        },
      } as unknown as RouterConfig);
      expect(config.profiles.auto!.medium?.models).toEqual([
        "ollama-cloud/deepseek-v4-flash:0731#low",
      ]);
      expect(warnings.some((w) => w.includes("nearby"))).toBe(true);
    });
  });
});
