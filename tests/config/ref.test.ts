import { describe, expect, it, vi } from "vitest";
import {
  mergeTier,
  resolveAvailableTier,
  resolveAvailableTier as resolveAvailableTierFromConfig,
} from "../../src/config/tier";
import { resolveAvailableTier as resolveAvailableTierFromRouting } from "../../src/routing";
import { normalizeConfig } from "../../src/config/normalize";
import {
  dereferenceTier,
  resolveAvailableTierLive,
  resolvableTiers,
  resolveProfileTierRefs,
} from "../../src/config/ref";
import type { RouterProfile } from "../../src/types";

const makeProfiles = (): Record<string, RouterProfile> => ({
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

describe("논리적 tier ref를 검증함", () => {
  describe("resolveProfileTierRefs 검증을 검증함", () => {
    it("ref를 치환하지 않고 그대로 둠을 검증함", () => {
      const profiles = makeProfiles();
      const warnings: string[] = [];
      resolveProfileTierRefs(profiles, warnings);
      expect(profiles.auto!.medium).toEqual({ ref: "copilot#high" });
      expect(warnings).toEqual([]);
    });
    it("object가 아닌 profile은 건너뜀을 검증함", () => {
      const profiles = { bad: "not-object" };
      const warnings: string[] = [];
      resolveProfileTierRefs(profiles, warnings);
      expect(warnings).toEqual([]);
    });
    it("ref와 다른 키가 함께 있어도 건드리지 않음을 검증함", () => {
      const profiles = makeProfiles();
      profiles.auto!.medium = { ref: "copilot#high", models: ["x/y"] };
      resolveProfileTierRefs(profiles, []);
      expect(profiles.auto!.medium).toEqual({ ref: "copilot#high", models: ["x/y"] });
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
    it("자기참조는 tier를 비활성화함을 검증함", () => {
      const profiles = makeProfiles();
      profiles.auto!.medium = { ref: "auto#medium" };
      const warnings: string[] = [];
      resolveProfileTierRefs(profiles, warnings);
      expect(profiles.auto!.medium).toBeUndefined();
      expect(warnings.some((w) => w.includes("itself"))).toBe(true);
    });
    it("존재하지 않는 대상도 논리적 참조로 유지함을 검증함", () => {
      const profiles = makeProfiles();
      profiles.auto!.medium = { ref: "missing#high" };
      const warnings: string[] = [];
      resolveProfileTierRefs(profiles, warnings);
      expect(profiles.auto!.medium).toEqual({ ref: "missing#high" });
    });
    it("ref가 없는 tier는 그대로 둠을 검증함", () => {
      const profiles = makeProfiles();
      const warnings: string[] = [];
      resolveProfileTierRefs(profiles, warnings);
      expect(profiles.auto!.high).toEqual({ models: ["xai/grok-4.6#high"] });
      expect(profiles.copilot!.medium).toEqual({ models: ["github-copilot/gpt-5.6-luna#high"] });
    });
  });

  describe("dereferenceTier 실시간 추적을 검증함", () => {
    it("ref를 대상 tier 값으로 추적함을 검증함", () => {
      const resolved = dereferenceTier(makeProfiles(), "auto", "medium");
      expect(resolved?.config).toEqual({ models: ["github-copilot/gpt-5.6-sol#high"] });
      expect(resolved?.profileName).toBe("copilot");
      expect(resolved?.tier).toBe("high");
    });
    it("원본 변경이 다음 추적에 바로 반영됨을 검증함", () => {
      const profiles = makeProfiles();
      expect(dereferenceTier(profiles, "auto", "medium")?.config).toEqual({
        models: ["github-copilot/gpt-5.6-sol#high"],
      });
      profiles.copilot!.high!.models = ["github-copilot/gpt-5.6-luna#high"];
      expect(dereferenceTier(profiles, "auto", "medium")?.config).toEqual({
        models: ["github-copilot/gpt-5.6-luna#high"],
      });
    });
    it("chained ref를 끝까지 따라감을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        a: { medium: { ref: "b#high" } },
        b: { high: { ref: "c#high" } },
        c: { high: { models: ["openai/gpt-4o"] } },
      };
      const resolved = dereferenceTier(profiles, "a", "medium");
      expect(resolved?.config).toEqual({ models: ["openai/gpt-4o"] });
      expect(resolved?.chain).toEqual(["a#medium", "b#high", "c#high"]);
    });
    it("순환 참조는 undefined를 반환함을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        a: { medium: { ref: "b#high" } },
        b: { high: { ref: "a#medium" } },
      };
      expect(dereferenceTier(profiles, "a", "medium")).toBeUndefined();
    });
    it("존재하지 않는 대상은 undefined를 반환함을 검증함", () => {
      const profiles = makeProfiles();
      profiles.auto!.medium = { ref: "missing#high" };
      expect(dereferenceTier(profiles, "auto", "medium")).toBeUndefined();
    });
    it("없는 tier는 대상 profile의 위쪽 가까운 tier로 추적함을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: { medium: { ref: "copilot#low" } },
        copilot: { high: { models: ["github-copilot/gpt-5.6-sol#high"] } },
      };
      const resolved = dereferenceTier(profiles, "auto", "medium");
      expect(resolved?.config).toEqual({ models: ["github-copilot/gpt-5.6-sol#high"] });
      expect(resolved?.tier).toBe("high");
    });
    it("위쪽이 없으면 아래쪽 가까운 tier로 추적함을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: { medium: { ref: "copilot#high" } },
        copilot: { low: { models: ["ollama-cloud/deepseek-v4-flash:0731#low"] } },
      };
      const resolved = dereferenceTier(profiles, "auto", "medium");
      expect(resolved?.config).toEqual({
        models: ["ollama-cloud/deepseek-v4-flash:0731#low"],
      });
    });
    it("대상 profile에 구체 tier가 없으면 undefined를 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: { medium: { ref: "copilot#high" } },
        copilot: {},
      };
      expect(dereferenceTier(profiles, "auto", "medium")).toBeUndefined();
    });
    it("high+low가 있으면 위쪽 high를 우선함을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: { medium: { ref: "copilot#medium" } },
        copilot: {
          high: { models: ["github-copilot/gpt-5.6-sol#high"] },
          low: { models: ["ollama-cloud/deepseek-v4-flash:0731#low"] },
        },
      };
      const resolved = dereferenceTier(profiles, "auto", "medium");
      expect(resolved?.tier).toBe("high");
    });
    it("resolveAvailableTier와 같은 tier를 고름을 검증함", () => {
      const target = {
        high: { models: ["github-copilot/gpt-5.6-sol#high"] },
        low: { models: ["ollama-cloud/deepseek-v4-flash:0731#low"] },
      };
      const profiles: Record<string, RouterProfile> = {
        auto: { medium: { ref: "copilot#medium" } },
        copilot: { ...target },
      };
      const resolved = dereferenceTier(profiles, "auto", "medium");
      expect(resolved?.tier).toBe(resolveAvailableTier(target, "medium"));
    });
    it("모델 없는 객체 tier는 undefined를 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: { medium: { contextWindow: 1000 } },
      };
      expect(dereferenceTier(profiles, "auto", "medium")).toBeUndefined();
    });
    it("형식 오류 ref를 live 추적하면 undefined를 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: { medium: { ref: "badformat" } },
      };
      expect(dereferenceTier(profiles, "auto", "medium")).toBeUndefined();
    });
    it("대상 profile 자체가 없으면 undefined를 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: { medium: { ref: "ghost#high" } },
      };
      expect(dereferenceTier(profiles, "auto", "medium")).toBeUndefined();
    });
    it("36홉을 넘는 체인은 중단하고 undefined를 검증함", () => {
      const profiles: Record<string, RouterProfile> = {};
      const n = 40;
      for (let i = 0; i < n; i++) {
        profiles[`p${i}`] = { medium: { ref: `p${i + 1}#medium` } };
      }
      profiles[`p${n}`] = { medium: { models: ["openai/gpt-4o"] } };
      expect(dereferenceTier(profiles, "p0", "medium")).toBeUndefined();
    });
    it("36홉 안의 체인은 끝까지 따라감을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {};
      const n = 10;
      for (let i = 0; i < n; i++) {
        profiles[`p${i}`] = { medium: { ref: `p${i + 1}#medium` } };
      }
      profiles[`p${n}`] = { medium: { models: ["openai/gpt-4o"] } };
      expect(dereferenceTier(profiles, "p0", "medium")?.config).toEqual({
        models: ["openai/gpt-4o"],
      });
    });
  });

  describe("resolveAvailableTierLive를 검증함", () => {
    it("ref tier도 해석 가능 tier로 셈을 검증함", () => {
      const found = resolveAvailableTierLive(makeProfiles(), "auto", "medium");
      expect(found?.tier).toBe("medium");
      expect(found?.resolved.config).toEqual({ models: ["github-copilot/gpt-5.6-sol#high"] });
    });
    it("깨진 ref는 같은 profile의 가까운 tier로 폴백함을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: {
          medium: { ref: "missing#high" },
          low: { models: ["ollama-cloud/deepseek-v4-flash:0731#low"] },
        },
      };
      const found = resolveAvailableTierLive(profiles, "auto", "medium");
      expect(found?.tier).toBe("low");
    });
    it("빈 자리 건너뛰고 가까운 tier를 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: { low: { models: ["ollama-cloud/deepseek-v4-flash:0731#low"] } },
      };
      const found = resolveAvailableTierLive(profiles, "auto", "medium");
      expect(found?.tier).toBe("low");
    });
    it("모두 해석 불가면 undefined를 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: { medium: { ref: "missing#high" } },
      };
      expect(resolveAvailableTierLive(profiles, "auto", "medium")).toBeUndefined();
    });
    it("없는 profile은 undefined를 검증함", () => {
      expect(resolveAvailableTierLive(makeProfiles(), "ghost", "medium")).toBeUndefined();
    });
  });

  describe("resolvableTiers를 검증함", () => {
    it("ref 포함 해석 가능 tier 목록을 검증함", () => {
      expect(resolvableTiers(makeProfiles(), "auto")).toEqual(["high", "medium", "low"]);
    });
    it("깨진 ref는 제외함을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: {
          medium: { ref: "missing#high" },
          low: { models: ["openai/gpt"] },
        },
      };
      expect(resolvableTiers(profiles, "auto")).toEqual(["low"]);
    });
    it("없는 profile은 빈 배열을 검증함", () => {
      expect(resolvableTiers(makeProfiles(), "ghost")).toEqual([]);
    });
  });

  describe("normalizeConfig 통합을 검증함", () => {
    it("auto.medium ref가 논리적 참조로 로드됨을 검증함", () => {
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
      });
      expect(warnings).toEqual([]);
      expect(config.profiles.auto!.medium).toEqual({ ref: "copilot#high" });
      expect(dereferenceTier(config.profiles, "auto", "medium")?.config.models).toEqual([
        "github-copilot/gpt-5.6-sol#high",
      ]);
    });
    it("ref 대상 변경이 추적 결과에 바로 반영됨을 검증함", () => {
      const { config } = normalizeConfig({
        profiles: {
          auto: { medium: { ref: "copilot#high" } },
          copilot: { high: { models: ["github-copilot/gpt-5.6-sol#high"] } },
        },
      });
      config.profiles.copilot!.high!.models = ["openai/gpt-4o"];
      expect(dereferenceTier(config.profiles, "auto", "medium")?.config.models).toEqual([
        "openai/gpt-4o",
      ]);
    });
    it("무효한 ref tier는 제외하고 유효 tier는 유지함을 검증함", () => {
      const { config, warnings } = normalizeConfig({
        profiles: {
          auto: {
            medium: { ref: "badformat" },
            low: { models: ["ollama-cloud/deepseek-v4-flash:0731#low"] },
          },
        },
      });
      expect(warnings.some((w) => w.includes("invalid ref"))).toBe(true);
      expect(config.profiles.auto!.medium).toBeUndefined();
      expect(config.profiles.auto!.low?.models).toEqual([
        "ollama-cloud/deepseek-v4-flash:0731#low",
      ]);
    });
    it("ref만 있고 모두 실패한 profile은 건너뜀을 검증함", () => {
      const { config, warnings } = normalizeConfig({
        profiles: { auto: { medium: { ref: "badformat" } } },
      });
      expect(config.profiles.auto).toBeUndefined();
      expect(warnings.some((w) => w.includes("has no valid tiers"))).toBe(true);
    });
  });

  describe("mergeTier ref 우선 병합을 검증함", () => {
    it("override ref는 기존 models와 섞이지 않음을 검증함", () => {
      const merged = mergeTier({ models: ["openai/a"] }, { ref: "copilot#high" });
      expect(merged).toEqual({ ref: "copilot#high" });
    });
  });

  describe("가까운 tier 폴백 공유를 검증함", () => {
    it("라우팅과 같은 함수를 공유함을 검증함", () => {
      expect(resolveAvailableTierFromConfig).toBe(resolveAvailableTierFromRouting);
    });
    it("structuredClone 유무와 무관하게 동작함을 검증함", () => {
      vi.stubGlobal("structuredClone", undefined);
      try {
        const resolved = dereferenceTier(makeProfiles(), "auto", "medium");
        expect(resolved?.config).toEqual({ models: ["github-copilot/gpt-5.6-sol#high"] });
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
