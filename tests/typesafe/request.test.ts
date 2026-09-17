import { describe, expect, it } from "vitest";
import { buildTypesafeRequest } from "../../src/typesafe/request";
import { DEFAULT_TIER_GUIDES, TIER_GUIDE_ORDER } from "../../src/config/tierGuides";
import { TYPESAFE_TIER_QUESTION_ID } from "../../src/typesafe/constants";

describe("buildTypesafeRequest를 검증함", () => {
  it("tierGuides가 없으면 내장 tier 설명을 선택지로 씀을 검증함", () => {
    const request = buildTypesafeRequest({ message: "hello" }, "jev-latest");
    const question = request.questions[TYPESAFE_TIER_QUESTION_ID];
    expect(request.model).toBe("jev-latest");
    expect(request.state).toEqual({ message: "hello" });
    expect(question?.type).toBe("choice");
    expect(question?.instructions.length).toBeGreaterThan(0);
    expect(Object.keys(question?.criteria ?? [])).toEqual([...TIER_GUIDE_ORDER]);
    for (const tier of TIER_GUIDE_ORDER) {
      expect(question?.criteria[tier]).toBe(DEFAULT_TIER_GUIDES[tier]);
    }
  });

  it("tierGuides 일부만 지정하면 나머지는 내장 설명을 유지함을 검증함", () => {
    const request = buildTypesafeRequest({ message: "m", history: "h" }, "jev-1.13.0", {
      high: "커스텀 high",
      low: "커스텀 low",
    });
    const question = request.questions[TYPESAFE_TIER_QUESTION_ID];
    expect(question?.criteria.high).toBe("커스텀 high");
    expect(question?.criteria.low).toBe("커스텀 low");
    expect(question?.criteria.medium).toBe(DEFAULT_TIER_GUIDES.medium);
    expect(request.state).toEqual({ message: "m", history: "h" });
    expect(request.model).toBe("jev-1.13.0");
  });
});
