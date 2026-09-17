import { describe, expect, it } from "vitest";
import { parseTypesafeResponse } from "../../src/typesafe/response";
import { TYPESAFE_TIER_QUESTION_ID } from "../../src/typesafe/constants";

const answerOf = (answer: unknown): unknown => ({
  answers: { [TYPESAFE_TIER_QUESTION_ID]: answer },
});

describe("parseTypesafeResponse를 검증함", () => {
  it("JSON object가 아니면 에러를 반환함을 검증함", () => {
    expect(parseTypesafeResponse("nope")).toEqual({ error: "Response is not a JSON object." });
    expect(parseTypesafeResponse(null)).toEqual({ error: "Response is not a JSON object." });
  });

  it("answers가 없으면 에러를 반환함을 검증함", () => {
    expect(parseTypesafeResponse({})).toEqual({
      error: 'Response has no "answers" object.',
    });
    expect(parseTypesafeResponse({ answers: [] })).toEqual({
      error: 'Response has no "answers" object.',
    });
  });

  it("tier 답변이 없으면 에러를 반환함을 검증함", () => {
    expect(parseTypesafeResponse({ answers: {} })).toEqual({
      error: `Response has no answer for "${TYPESAFE_TIER_QUESTION_ID}".`,
    });
  });

  it("choice 답변이 아니면 에러를 반환함을 검증함", () => {
    expect(parseTypesafeResponse(answerOf({ type: "noul", noul: 0.9 }))).toEqual({
      error: `Answer "${TYPESAFE_TIER_QUESTION_ID}" is not a choice answer.`,
    });
  });

  it("알 수 없는 tier면 에러를 반환함을 검증함", () => {
    const result = parseTypesafeResponse(answerOf({ type: "choice", choice: "gigantic" }));
    expect(result).toEqual({
      error: `Answer "${TYPESAFE_TIER_QUESTION_ID}" returned an unknown tier: "gigantic".`,
    });
  });

  it("choice·confidence·probabilities를 파싱함을 검증함", () => {
    const result = parseTypesafeResponse(
      answerOf({
        type: "choice",
        choice: "high",
        confidence: 0.82,
        probabilities: { low: 0.05, medium: 0.13, high: 0.82 },
      }),
    );
    expect(result).toEqual({
      result: {
        tier: "high",
        confidence: 0.82,
        probabilities: { low: 0.05, medium: 0.13, high: 0.82 },
      },
    });
  });

  it("confidence가 없거나 숫자가 아니면 undefined로 처리함을 검증함", () => {
    expect(parseTypesafeResponse(answerOf({ type: "choice", choice: "low" }))).toEqual({
      result: { tier: "low", confidence: undefined, probabilities: undefined },
    });
    expect(
      parseTypesafeResponse(answerOf({ type: "choice", choice: "low", confidence: "0.9" })),
    ).toEqual({ result: { tier: "low", confidence: undefined, probabilities: undefined } });
    expect(
      parseTypesafeResponse(answerOf({ type: "choice", choice: "low", confidence: Number.NaN })),
    ).toEqual({ result: { tier: "low", confidence: undefined, probabilities: undefined } });
  });

  it("probabilities에서 숫자가 아닌 값을 걸러냄을 검증함", () => {
    expect(
      parseTypesafeResponse(
        answerOf({
          type: "choice",
          choice: "medium",
          confidence: 0.6,
          probabilities: { medium: 0.6, high: "0.4", max: Number.POSITIVE_INFINITY },
        }),
      ),
    ).toEqual({
      result: { tier: "medium", confidence: 0.6, probabilities: { medium: 0.6 } },
    });
  });

  it("probabilities가 object가 아니거나 숫자가 없으면 undefined임을 검증함", () => {
    expect(
      parseTypesafeResponse(
        answerOf({ type: "choice", choice: "medium", confidence: 0.6, probabilities: [] }),
      ),
    ).toEqual({ result: { tier: "medium", confidence: 0.6, probabilities: undefined } });
    expect(
      parseTypesafeResponse(
        answerOf({
          type: "choice",
          choice: "medium",
          confidence: 0.6,
          probabilities: { medium: "0.6" },
        }),
      ),
    ).toEqual({ result: { tier: "medium", confidence: 0.6, probabilities: undefined } });
  });
});
