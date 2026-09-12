import { describe, expect, it } from "vitest";
import { resolveDelegatedReasoning } from "../../src/config/reasoning";
import { makeFakeModel } from "../helpers";

describe("reasoning을 검증함", () => {
  it("요청이 undefined면 undefined 반환함을 검증함", () => {
    expect(
      resolveDelegatedReasoning(makeFakeModel({ reasoning: true }), undefined),
    ).toBeUndefined();
  });
  it("reasoning 없는 모델은 undefined 반환함을 검증함", () => {
    expect(resolveDelegatedReasoning(makeFakeModel({ reasoning: false }), "high")).toBeUndefined();
    expect(resolveDelegatedReasoning(makeFakeModel(), "high")).toBeUndefined();
    expect(
      resolveDelegatedReasoning(makeFakeModel({ reasoning: undefined }), "high"),
    ).toBeUndefined();
  });
  it("모델이 지원해도 off 요청은 undefined 반환함을 검증함", () => {
    expect(resolveDelegatedReasoning(makeFakeModel({ reasoning: true }), "off")).toBeUndefined();
  });
  it("reasoning true 모델의 high 요청은 high 반환함을 검증함", () => {
    expect(resolveDelegatedReasoning(makeFakeModel({ reasoning: true }), "high")).toBe("high");
  });
  it("빈 문자열 요청은 falsy로 undefined 반환함을 검증함", () => {
    expect(resolveDelegatedReasoning(makeFakeModel({ reasoning: true }), "")).toBeUndefined();
  });
  it("reasoning false 모델 요청은 undefined 반환함을 검증함", () => {
    expect(resolveDelegatedReasoning(makeFakeModel({ reasoning: false }), "off")).toBeUndefined();
  });
});
