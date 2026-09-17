import { describe, expect, it, vi } from "vitest";
import { mergeTier, resolveAvailableTier } from "../../src/config/tier";
import {
  buildRoutingDecisionLive,
  resolveAvailableTier as resolveAvailableTierFromRouting,
} from "../../src/routing";
import { normalizeConfig } from "../../src/config/normalize";
import {
  applyEffortOverride,
  dereferenceTier,
  resolveAvailableTierLive,
  resolvableTiers,
} from "../../src/config/ref";
import { parseDelegatedRef } from "../../src/config/modelRef";
import type { RouterProfile } from "../../src/types";

const makeProfiles = (): Record<string, RouterProfile> => ({
  auto: {
    high: { models: ["xai/grok-4.6#high"] },
    medium: { models: ["@copilot#high"] },
    low: { models: ["ollama-cloud/deepseek-v4-flash:0731#low"] },
  },
  copilot: {
    high: { models: ["github-copilot/gpt-5.6-sol#high"] },
    medium: { models: ["github-copilot/gpt-5.6-luna#high"] },
  },
});

/** 위임/강제 effort 시나리오용 프로필 (사용자 cheap 예시와 같은 구조). 정규화를 거쳐 모델 상속이 적용됨. */
const makeDelegationProfiles = (): Record<string, RouterProfile> => {
  const { config } = normalizeConfig({
    profiles: {
      cheap: {
        models: ["@glm", "@deepseek#low", "openai/luna", "xai/g#low"],
        max: { effort: "max" },
        high: {
          models: ["@deepseek#medium", "@glm", "openai/luna", "xai/g#low"],
          effort: "high",
        },
        low: { models: ["@deepseek#low", "@glm", "openai/luna", "xai/g#medium"] },
      },
      glm: {
        models: ["glm/g1"],
        max: { effort: "max" },
        high: { effort: "high" },
        medium: { effort: "low" },
      },
      deepseek: {
        models: ["ds/d1"],
        max: { effort: "max" },
        high: { effort: "high" },
        medium: { effort: "low" },
        low: { effort: "low" },
      },
    },
  });
  return config.profiles;
};

describe("위임 models 확장을 검증함", () => {
  describe("parseDelegatedRef 파싱을 검증함", () => {
    it("profile만 있으면 기본 티어(medium)로 파싱함을 검증함", () => {
      expect(parseDelegatedRef("copilot")).toEqual({ profile: "copilot", tier: "medium" });
    });
    it("profile#tier를 파싱함을 검증함", () => {
      expect(parseDelegatedRef("copilot#high")).toEqual({ profile: "copilot", tier: "high" });
    });
    it("profile#tier#effort를 파싱함을 검증함", () => {
      expect(parseDelegatedRef("copilot#high#off")).toEqual({
        profile: "copilot",
        tier: "high",
        effort: "off",
      });
    });
    it("공백을 제거하고 파싱함을 검증함", () => {
      expect(parseDelegatedRef(" copilot # high # off ")).toEqual({
        profile: "copilot",
        tier: "high",
        effort: "off",
      });
    });
    it("잘못된 위임 참조는 undefined를 검증함", () => {
      const cases = ["", "p#", "p#bad", "p#h#bogus", "p#high#bogus", "p#a#b#c", "p##off", "#high"];
      for (const ref of cases) {
        expect(parseDelegatedRef(ref)).toBeUndefined();
      }
    });
  });

  describe("dereferenceTier 실시간 확장을 검증함", () => {
    it("effort가 없으면 config를 그대로 반환함을 검증함", () => {
      const config = { models: ["openai/a"] };
      expect(applyEffortOverride(config, undefined)).toBe(config);
    });
    it("잘못된 위임 형식 및 중복 위임 시 체인 중복 방지를 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        main: {
          medium: { models: ["@child#high", "@child#high", "@bad#invalidtier", "openai/a"] },
        },
        child: {
          high: { models: ["child/model#high"] },
        },
      };
      const resolved = dereferenceTier(profiles, "main", "medium");
      expect(resolved?.config.models).toEqual([
        "child/model#high",
        "child/model#high",
        "openai/a",
      ]);
      expect(resolved?.chain).toEqual(["main#medium", "child#high"]);
    });
    it("위임을 대상 tier 모델로 펼침을 검증함", () => {
      const resolved = dereferenceTier(makeProfiles(), "auto", "medium");
      expect(resolved?.config.models).toEqual(["github-copilot/gpt-5.6-sol#high"]);
      expect(resolved?.profileName).toBe("auto");
      expect(resolved?.tier).toBe("medium");
      expect(resolved?.chain).toEqual(["auto#medium", "copilot#high"]);
    });
    it("원본 변경이 다음 확장에 바로 반영됨을 검증함", () => {
      const profiles = makeProfiles();
      expect(dereferenceTier(profiles, "auto", "medium")?.config.models).toEqual([
        "github-copilot/gpt-5.6-sol#high",
      ]);
      profiles.copilot!.high!.models = ["github-copilot/gpt-5.6-luna#high"];
      expect(dereferenceTier(profiles, "auto", "medium")?.config.models).toEqual([
        "github-copilot/gpt-5.6-luna#high",
      ]);
    });
    it("tier 없는 위임은 기본 티어(medium)로 펼침을 검증함", () => {
      const resolved = dereferenceTier(makeProfiles(), "auto", "high");
      const profiles = makeProfiles();
      profiles.auto!.high = { models: ["@copilot"] };
      const delegated = dereferenceTier(profiles, "auto", "high");
      expect(delegated?.config.models).toEqual(
        dereferenceTier(profiles, "copilot", "medium")?.config.models,
      );
      expect(resolved).toBeDefined();
    });
    it("tier effort 강제가 위임 결과와 모델별 #보다 우선함을 검증함", () => {
      const profiles = makeDelegationProfiles();
      expect(dereferenceTier(profiles, "cheap", "max")?.config.models).toEqual([
        "glm/g1#max",
        "ds/d1#max",
        "openai/luna#max",
        "xai/g#max",
      ]);
      expect(dereferenceTier(profiles, "cheap", "high")?.config.models).toEqual([
        "ds/d1#high",
        "glm/g1#high",
        "openai/luna#high",
        "xai/g#high",
      ]);
    });
    it("tier effort가 없으면 모델별 #와 대상 tier 강제값을 유지함을 검증함", () => {
      const profiles = makeDelegationProfiles();
      expect(dereferenceTier(profiles, "cheap", "low")?.config.models).toEqual([
        "ds/d1#low",
        "glm/g1#low",
        "openai/luna",
        "xai/g#medium",
      ]);
    });
    it("위임 참조의 #effort가 대상 tier 강제값보다 우선함을 검증함", () => {
      const profiles = makeDelegationProfiles();
      profiles.cheap!.low = { models: ["@deepseek#low#off", "@glm#low#max"] };
      expect(dereferenceTier(profiles, "cheap", "low")?.config.models).toEqual([
        "ds/d1#off",
        "glm/g1#max",
      ]);
    });
    it("중첩 위임을 끝까지 펼침을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        a: { medium: { models: ["@b#high"] } },
        b: { high: { models: ["@c#medium"] } },
        c: { medium: { models: ["openai/gpt-4o"] } },
      };
      const resolved = dereferenceTier(profiles, "a", "medium");
      expect(resolved?.config.models).toEqual(["openai/gpt-4o"]);
      expect(resolved?.chain).toEqual(["a#medium", "b#high", "c#medium"]);
    });
    it("순환 위임은 undefined를 반환함을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        a: { medium: { models: ["@b#high"] } },
        b: { high: { models: ["@a#medium"] } },
      };
      expect(dereferenceTier(profiles, "a", "medium")).toBeUndefined();
    });
    it("자기 위재는 형제 항목을 유지하고 자기 항목만 건너뜀을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: { medium: { models: ["@auto#medium", "openai/gpt"] } },
      };
      expect(dereferenceTier(profiles, "auto", "medium")?.config.models).toEqual(["openai/gpt"]);
    });
    it("존재하지 않는 위임 대상은 건너뜀을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: { medium: { models: ["@ghost#high"] } },
      };
      expect(dereferenceTier(profiles, "auto", "medium")).toBeUndefined();
    });
    it("없는 tier는 대상 profile의 위쪽 가까운 tier로 펼침을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: { medium: { models: ["@copilot#low"] } },
        copilot: { high: { models: ["github-copilot/gpt-5.6-sol#high"] } },
      };
      const resolved = dereferenceTier(profiles, "auto", "medium");
      expect(resolved?.config.models).toEqual(["github-copilot/gpt-5.6-sol#high"]);
      expect(resolved?.chain).toEqual(["auto#medium", "copilot#high"]);
    });
    it("위쪽이 없으면 아래쪽 가까운 tier로 펼침을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: { medium: { models: ["@copilot#high"] } },
        copilot: { low: { models: ["ollama-cloud/deepseek-v4-flash:0731#low"] } },
      };
      const resolved = dereferenceTier(profiles, "auto", "medium");
      expect(resolved?.config.models).toEqual(["ollama-cloud/deepseek-v4-flash:0731#low"]);
    });
    it("대상 profile에 모델 tier가 없으면 undefined를 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: { medium: { models: ["@copilot#high"] } },
        copilot: {},
      };
      expect(dereferenceTier(profiles, "auto", "medium")).toBeUndefined();
    });
    it("high+low가 있으면 위쪽 high를 우선함을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: { medium: { models: ["@copilot#medium"] } },
        copilot: {
          high: { models: ["github-copilot/gpt-5.6-sol#high"] },
          low: { models: ["ollama-cloud/deepseek-v4-flash:0731#low"] },
        },
      };
      const resolved = dereferenceTier(profiles, "auto", "medium");
      expect(resolved?.chain).toEqual(["auto#medium", "copilot#high"]);
    });
    it("resolveAvailableTier와 같은 tier를 고름을 검증함", () => {
      const target = {
        high: { models: ["github-copilot/gpt-5.6-sol#high"] },
        low: { models: ["ollama-cloud/deepseek-v4-flash:0731#low"] },
      };
      const profiles: Record<string, RouterProfile> = {
        auto: { medium: { models: ["@copilot#medium"] } },
        copilot: { ...target },
      };
      const resolved = dereferenceTier(profiles, "auto", "medium");
      expect(resolved?.chain[1]).toBe(`copilot#${resolveAvailableTier(target, "medium")}`);
    });
    it("모델 없는 객체 tier는 undefined를 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: { medium: { contextWindow: 1000 } },
      };
      expect(dereferenceTier(profiles, "auto", "medium")).toBeUndefined();
    });
    it("대상 profile 자체가 없으면 undefined를 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: { medium: { models: ["@ghost#high"] } },
      };
      expect(dereferenceTier(profiles, "auto", "medium")).toBeUndefined();
    });
    it("확장 예산을 넘는 위임 체인은 중단함을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {};
      const n = 300;
      for (let i = 0; i < n; i++) {
        profiles[`p${i}`] = { medium: { models: [`@p${i + 1}#medium`] } };
      }
      profiles[`p${n}`] = { medium: { models: ["openai/gpt-4o"] } };
      expect(dereferenceTier(profiles, "p0", "medium")).toBeUndefined();
    });
    it("예산 안의 위임 체인은 끝까지 펼침을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {};
      const n = 10;
      for (let i = 0; i < n; i++) {
        profiles[`p${i}`] = { medium: { models: [`@p${i + 1}#medium`] } };
      }
      profiles[`p${n}`] = { medium: { models: ["openai/gpt-4o"] } };
      expect(dereferenceTier(profiles, "p0", "medium")?.config.models).toEqual(["openai/gpt-4o"]);
    });
  });

  describe("resolveAvailableTierLive를 검증함", () => {
    it("위임 tier도 해석 가능 tier로 셈을 검증함", () => {
      const found = resolveAvailableTierLive(makeProfiles(), "auto", "medium");
      expect(found?.tier).toBe("medium");
      expect(found?.resolved.config.models).toEqual(["github-copilot/gpt-5.6-sol#high"]);
    });
    it("깨진 위임은 같은 profile의 가까운 tier로 폴백함을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: {
          medium: { models: ["@ghost#high"] },
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
        auto: { medium: { models: ["@ghost#high"] } },
      };
      expect(resolveAvailableTierLive(profiles, "auto", "medium")).toBeUndefined();
    });
    it("없는 profile은 undefined를 검증함", () => {
      expect(resolveAvailableTierLive(makeProfiles(), "ghost", "medium")).toBeUndefined();
    });
  });

  describe("resolvableTiers를 검증함", () => {
    it("위임 포함 해석 가능 tier 목록을 검증함", () => {
      expect(resolvableTiers(makeProfiles(), "auto")).toEqual(["high", "medium", "low"]);
    });
    it("깨진 위임은 제외함을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: {
          medium: { models: ["@ghost#high"] },
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
    it("auto.medium 위임 models가 로드되고 실시간 확장됨을 검증함", () => {
      const { config, warnings } = normalizeConfig({
        profiles: {
          auto: {
            high: { models: ["xai/grok-4.6#high"] },
            medium: { models: ["@copilot#high"] },
            low: { models: ["ollama-cloud/deepseek-v4-flash:0731#low"] },
          },
          copilot: {
            high: { models: ["github-copilot/gpt-5.6-sol#high"] },
            medium: { models: ["github-copilot/gpt-5.6-luna#high"] },
          },
        },
      });
      expect(warnings).toEqual([]);
      expect(config.profiles.auto!.medium?.models).toEqual(["@copilot#high"]);
      expect(dereferenceTier(config.profiles, "auto", "medium")?.config.models).toEqual([
        "github-copilot/gpt-5.6-sol#high",
      ]);
    });
    it("위임 대상 변경이 확장 결과에 바로 반영됨을 검증함", () => {
      const { config } = normalizeConfig({
        profiles: {
          auto: { medium: { models: ["@copilot#high"] } },
          copilot: { high: { models: ["github-copilot/gpt-5.6-sol#high"] } },
        },
      });
      config.profiles.copilot!.high!.models = ["openai/gpt-4o"];
      expect(dereferenceTier(config.profiles, "auto", "medium")?.config.models).toEqual([
        "openai/gpt-4o",
      ]);
    });
    it("제거된 ref 필드는 경고하고 tier를 비활성화함을 검증함", () => {
      const { config, warnings } = normalizeConfig({
        profiles: {
          auto: {
            medium: { ref: "copilot#high" },
            low: { models: ["ollama-cloud/deepseek-v4-flash:0731#low"] },
          },
        },
      });
      expect(warnings.some((w) => w.includes('removed "ref"'))).toBe(true);
      expect(config.profiles.auto!.medium).toBeUndefined();
      expect(config.profiles.auto!.low?.models).toEqual([
        "ollama-cloud/deepseek-v4-flash:0731#low",
      ]);
    });
    it("ref만 있던 profile은 건너뜀을 검증함", () => {
      const { config, warnings } = normalizeConfig({
        profiles: { auto: { medium: { ref: "copilot#high" } } },
      });
      expect(config.profiles.auto).toBeUndefined();
      expect(warnings.some((w) => w.includes("has no valid tiers"))).toBe(true);
    });
  });

  describe("mergeTier 병합을 검증함", () => {
    it("override가 기존 설정을 덮어씀을 검증함", () => {
      const merged = mergeTier({ models: ["openai/a"] }, { models: ["x/b"], effort: "high" });
      expect(merged).toEqual({ models: ["x/b"], effort: "high" });
    });
    it("override에 없는 키는 기존을 유지함을 검증함", () => {
      const merged = mergeTier({ models: ["openai/a"] }, { effort: "high" });
      expect(merged).toEqual({ models: ["openai/a"], effort: "high" });
    });
  });

  describe("가까운 tier 폴백 공유를 검증함", () => {
    it("라우팅과 같은 함수를 공유함을 검증함", () => {
      expect(resolveAvailableTier).toBe(resolveAvailableTierFromRouting);
    });
    it("structuredClone 유무와 무관하게 동작함을 검증함", () => {
      vi.stubGlobal("structuredClone", undefined);
      try {
        const resolved = dereferenceTier(makeProfiles(), "auto", "medium");
        expect(resolved?.config.models).toEqual(["github-copilot/gpt-5.6-sol#high"]);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe("라우팅 결정을 검증함", () => {
    it("buildRoutingDecisionLive가 위임 확장 모델과 강제 effort를 사용함을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: { low: { models: ["@deepseek-flash#low#off"] } },
        "deepseek-flash": { low: { models: ["ollama-cloud/deepseek-v4.1-flash"] } },
      };
      const decision = buildRoutingDecisionLive(profiles, "auto", "low", "test");
      expect(decision.targetProvider).toBe("ollama-cloud");
      expect(decision.targetModelId).toBe("deepseek-v4.1-flash");
      expect(decision.targetLabel).toBe("ollama-cloud/deepseek-v4.1-flash");
      expect(decision.thinking).toBe("off");
      expect(decision.reasoning).toContain("[ref: auto#low -> deepseek-flash#low]");
    });
    it("tier 강제 effort가 모델별 #보다 우선해 결정에 반영됨을 검증함", () => {
      const profiles: Record<string, RouterProfile> = {
        auto: { low: { models: ["ollama-cloud/deepseek-v4.1-flash#high"], effort: "off" } },
      };
      const decision = buildRoutingDecisionLive(profiles, "auto", "low", "test");
      expect(decision.thinking).toBe("off");
    });
    it("normalizeConfig 통합으로 위임 models가 로드됨을 검증함", () => {
      const { config, warnings } = normalizeConfig({
        profiles: {
          auto: { low: { models: ["@deepseek#low#off"] } },
          deepseek: { low: { models: ["x/m"] } },
        },
      });
      expect(warnings).toEqual([]);
      expect(config.profiles.auto!.low?.models).toEqual(["@deepseek#low#off"]);
      expect(dereferenceTier(config.profiles, "auto", "low")?.config.models).toEqual(["x/m#off"]);
    });
  });
});
