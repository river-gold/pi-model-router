import { describe, expect, it } from "vitest";
import {
  buildRoutingDecision,
  buildRoutingDecisionLive,
  decideRouting,
  resolveTierModelsLive,
} from "../src/routing";
import type { RouterProfile } from "../src/types";

const profiles = (over: Record<string, RouterProfile> = {}): Record<string, RouterProfile> => ({
  auto: {
    high: { models: ["xai/grok-4.6#high"] },
    medium: { ref: "copilot#high" },
    low: { models: ["ollama-cloud/deepseek-v4-flash:0731#low"] },
  },
  copilot: {
    high: { models: ["github-copilot/gpt-5.6-sol#high"] },
    medium: { models: ["github-copilot/gpt-5.6-luna#high"] },
  },
  ...over,
});

describe("논리적 ref 라우팅 결정을 검증함", () => {
  it("concrete ref tier에 buildRoutingDecision을 쓰면 안내 에러를 검증함", () => {
    const profile: RouterProfile = { medium: { ref: "copilot#high" } };
    expect(() => buildRoutingDecision("auto", profile, "medium", "r")).toThrow(
      /logical ref.*buildRoutingDecisionLive/,
    );
  });
  it("ref를 추적해 cross-profile 결정과 경로 표기를 검증함", () => {
    const d = buildRoutingDecisionLive(profiles(), "auto", "medium", "base", false);
    expect(d.profile).toBe("auto");
    expect(d.tier).toBe("medium");
    expect(d.targetProvider).toBe("github-copilot");
    expect(d.targetModelId).toBe("gpt-5.6-sol");
    expect(d.reasoning).toContain("[ref: auto#medium -> copilot#high]");
  });
  it("ref 없는 tier는 경로 표기 없이 결정함을 검증함", () => {
    const d = buildRoutingDecisionLive(profiles(), "auto", "high", "base", false);
    expect(d.targetModelId).toBe("grok-4.6");
    expect(d.reasoning).not.toContain("[ref:");
  });
  it("없는 tier는 가까운 tier로 폴백 표기함을 검증함", () => {
    const ps = profiles({
      solo: { low: { models: ["openai/gpt-low"] } },
    });
    const d = buildRoutingDecisionLive(ps, "solo", "medium", "base", false);
    expect(d.tier).toBe("low");
    expect(d.reasoning).toContain("Resolved from medium to low");
  });
  it("해석 불가 tier는 throw함을 검증함", () => {
    const ps: Record<string, RouterProfile> = {
      broken: { medium: { ref: "missing#high" } },
    };
    expect(() => buildRoutingDecisionLive(ps, "broken", "medium", "base")).toThrow(
      /no resolvable configuration/,
    );
  });
  it("profiles를 주면 decideRouting이 live로 동작함을 검증함", () => {
    const ps = profiles();
    const d = decideRouting({ messages: [] }, "auto", ps.auto!, undefined, ps);
    expect(d.profile).toBe("auto");
    expect(d.tier).toBe("medium");
    expect(d.targetModelId).toBe("gpt-5.6-sol");
  });
  it("resolveTierModelsLive가 추적된 모델 목록을 검증함", () => {
    expect(resolveTierModelsLive(profiles(), "auto", "medium")).toEqual([
      "github-copilot/gpt-5.6-sol#high",
    ]);
  });
  it("resolveTierModelsLive가 해석 불가 시 undefined를 검증함", () => {
    const ps: Record<string, RouterProfile> = {
      broken: { medium: { ref: "missing#high" } },
    };
    expect(resolveTierModelsLive(ps, "broken", "medium")).toBeUndefined();
  });
});
