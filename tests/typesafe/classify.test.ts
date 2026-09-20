import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "@earendil-works/pi-ai";
import { classifyWithTypesafe } from "../../src/typesafe/classify";
import type { TypesafeFetch, TypesafeHttpResponse } from "../../src/typesafe/client";
import { TYPESAFE_TIER_QUESTION_ID } from "../../src/typesafe/constants";

const response = (status: number, body: string): TypesafeHttpResponse => ({
  status,
  text: async () => body,
});

const choiceBody = (choice: string, confidence?: number): string =>
  JSON.stringify({
    model: "jev-latest",
    answers: {
      [TYPESAFE_TIER_QUESTION_ID]: {
        type: "choice",
        choice,
        probabilities: { [choice]: 0.7, other: 0.3 },
        ...(confidence === undefined ? {} : { confidence }),
      },
    },
  });

const baseParams = {
  context: { messages: [{ role: "user", content: "do it", timestamp: 1 }] } as Context,
  model: "jev-latest",
  historySize: 0,
  confidenceThreshold: 0.5,
  env: { TYPESAFE_API_KEY: "test-key" },
};

const readBody = (fetchFn: ReturnType<typeof vi.fn>): unknown =>
  JSON.parse((fetchFn.mock.calls[0]![1] as { body: string }).body);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("classifyWithTypesafe를 검증함", () => {
  it("API 키가 없으면 에러를 반환함을 검증함", async () => {
    const fetchFn = vi.fn<TypesafeFetch>();
    expect(await classifyWithTypesafe({ ...baseParams, env: {}, fetchFn })).toEqual({
      error: "TYPESAFE_API_KEY is not set.",
    });
    expect(
      await classifyWithTypesafe({ ...baseParams, env: { TYPESAFE_API_KEY: "  " }, fetchFn }),
    ).toEqual({
      error: "TYPESAFE_API_KEY is not set.",
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("env를 넘기지 않으면 process.env를 읽음을 검증함", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "env-key");
    const fetchFn = vi.fn<TypesafeFetch>().mockResolvedValue(response(200, choiceBody("low", 0.9)));
    const result = await classifyWithTypesafe({
      context: baseParams.context,
      model: "jev-latest",
      historySize: 0,
      confidenceThreshold: 0.5,
      fetchFn,
    });
    expect(result).toEqual({
      result: {
        tier: "low",
        reasoning: "TypeSafe chose low (confidence 0.90).",
        confidence: 0.9,
        probabilities: { low: 0.7, other: 0.3 },
      },
    });
    expect(
      (fetchFn.mock.calls[0]![1] as { headers: Record<string, string> }).headers.authorization,
    ).toBe("Bearer env-key");
  });

  it("최근 메시지를 state.message로 보내고 결과를 반환함을 검증함", async () => {
    const fetchFn = vi
      .fn<TypesafeFetch>()
      .mockResolvedValue(response(200, choiceBody("medium", 0.8)));
    const result = await classifyWithTypesafe({ ...baseParams, fetchFn });
    expect(result).toEqual({
      result: {
        tier: "medium",
        reasoning: "TypeSafe chose medium (confidence 0.80).",
        confidence: 0.8,
        probabilities: { medium: 0.7, other: 0.3 },
      },
    });
    expect(readBody(fetchFn)).toEqual(
      expect.objectContaining({ state: { message: "do it" }, model: "jev-latest" }),
    );
  });

  it("historySize가 있으면 history를 state에 포함함을 검증함", async () => {
    const fetchFn = vi
      .fn<TypesafeFetch>()
      .mockResolvedValue(response(200, choiceBody("high", 0.9)));
    const context = {
      messages: [
        { role: "user", content: "first", timestamp: 1 },
        { role: "assistant", content: "done", timestamp: 2 },
        { role: "user", content: "second", timestamp: 3 },
      ],
    } as Context;
    await classifyWithTypesafe({ ...baseParams, context, historySize: 1, fetchFn });
    expect(readBody(fetchFn)).toEqual(
      expect.objectContaining({
        state: { message: "second", history: "first\ndone" },
      }),
    );
  });

  it("history가 비어 있으면 message만 보냄을 검증함", async () => {
    const fetchFn = vi.fn<TypesafeFetch>().mockResolvedValue(response(200, choiceBody("low", 0.9)));
    await classifyWithTypesafe({ ...baseParams, historySize: 3, fetchFn });
    expect(readBody(fetchFn)).toEqual(expect.objectContaining({ state: { message: "do it" } }));
  });

  it("툴 루프 중이면 현재 턴 진행상황을 state.progress로 보냄을 검증함", async () => {
    const fetchFn = vi
      .fn<TypesafeFetch>()
      .mockResolvedValue(response(200, choiceBody("high", 0.9)));
    const context = {
      messages: [
        { role: "user", content: "do it", timestamp: 1 },
        {
          role: "toolResult",
          toolCallId: "1",
          toolName: "t",
          content: [{ type: "text", text: "tool out" }],
          isError: false,
          timestamp: 2,
        },
      ],
    } as Context;
    await classifyWithTypesafe({ ...baseParams, context, fetchFn });
    expect(readBody(fetchFn)).toEqual(
      expect.objectContaining({ state: { message: "do it", progress: "tool out" } }),
    );
  });

  it("history pair가 2,000자를 넘으면 뒤쪽만 남겨 자름을 검증함", async () => {
    const longFinal = "a".repeat(3_000);
    const context = {
      messages: [
        { role: "user", content: "first", timestamp: 1 },
        { role: "assistant", content: longFinal, timestamp: 2 },
        { role: "user", content: "second", timestamp: 3 },
      ],
    } as Context;
    const fetchFn = vi.fn<TypesafeFetch>().mockResolvedValue(response(200, choiceBody("low", 0.9)));
    await classifyWithTypesafe({ ...baseParams, context, historySize: 1, fetchFn });
    const state = (readBody(fetchFn) as { state: { history: string } }).state;
    expect(state.history.length).toBe(2_000);
    expect(state.history.startsWith("…")).toBe(true);
    // 남은 부분은 최종 결과 텍스트의 뒤쪽(모두 a)이어야 함.
    expect(state.history.slice(1)).toBe("a".repeat(1_999));
  });

  it("history 전체가 8,000자를 넘으면 최신 쌍 위주로 뒤쪽만 남김을 검증함", async () => {
    const pair = (n: number, size: number) => [
      { role: "user", content: `${n}`.padEnd(20, "u"), timestamp: n * 2 },
      { role: "assistant", content: `${n}`.padEnd(size, "a"), timestamp: n * 2 + 1 },
    ];
    const context = {
      messages: [
        ...pair(1, 1_900),
        ...pair(2, 1_900),
        ...pair(3, 1_900),
        ...pair(4, 1_900),
        ...pair(5, 1_900),
        { role: "user", content: "current", timestamp: 99 },
      ],
    } as Context;
    const fetchFn = vi.fn<TypesafeFetch>().mockResolvedValue(response(200, choiceBody("low", 0.9)));
    await classifyWithTypesafe({ ...baseParams, context, historySize: 5, fetchFn });
    const state = (readBody(fetchFn) as { state: { history: string } }).state;
    expect(state.history.length).toBe(8_000);
    expect(state.history.startsWith("…")).toBe(true);
    // 가장 최근(5번) 쌍의 user 텍스트는 남고, 가장 오래된(1번) 쌍은 잘려 나가야 함.
    expect(state.history).toContain("5".padEnd(20, "u"));
    expect(state.history).not.toContain("1".padEnd(20, "u"));
  });

  it("history가 상한 이내면 자르지 않음을 검증함", async () => {
    const context = {
      messages: [
        { role: "user", content: "first", timestamp: 1 },
        { role: "assistant", content: "done", timestamp: 2 },
        { role: "user", content: "second", timestamp: 3 },
      ],
    } as Context;
    const fetchFn = vi.fn<TypesafeFetch>().mockResolvedValue(response(200, choiceBody("low", 0.9)));
    await classifyWithTypesafe({ ...baseParams, context, historySize: 1, fetchFn });
    expect(readBody(fetchFn)).toEqual(
      expect.objectContaining({ state: { message: "second", history: "first\ndone" } }),
    );
  });

  it("confidence가 낮으면 한 단계 위 tier로 승격함을 검증함", async () => {
    const fetchFn = vi
      .fn<TypesafeFetch>()
      .mockResolvedValue(response(200, choiceBody("medium", 0.2)));
    const result = await classifyWithTypesafe({ ...baseParams, fetchFn });
    expect(result).toEqual({
      result: {
        tier: "high",
        reasoning: "TypeSafe chose medium (confidence 0.20 < 0.5) → escalated to high.",
        confidence: 0.2,
        probabilities: { medium: 0.7, other: 0.3 },
      },
    });
  });

  it("tierGuides를 요청 선택지에 반영함을 검증함", async () => {
    const fetchFn = vi.fn<TypesafeFetch>().mockResolvedValue(response(200, choiceBody("low", 0.9)));
    await classifyWithTypesafe({
      ...baseParams,
      tierGuides: { low: "커스텀 low" },
      fetchFn,
    });
    const body = readBody(fetchFn) as {
      questions: Record<string, { criteria: Record<string, string> }>;
    };
    expect(body.questions[TYPESAFE_TIER_QUESTION_ID]?.criteria.low).toBe("커스텀 low");
  });

  it("HTTP 실패와 응답 파싱 실패를 에러로 반환함을 검증함", async () => {
    const failing = vi.fn<TypesafeFetch>().mockResolvedValue(response(401, "nope"));
    expect(await classifyWithTypesafe({ ...baseParams, fetchFn: failing })).toEqual({
      error: "TypeSafe request failed (401): nope",
    });

    const malformed = vi
      .fn<TypesafeFetch>()
      .mockResolvedValue(response(200, JSON.stringify({ model: "jev-latest" })));
    expect(await classifyWithTypesafe({ ...baseParams, fetchFn: malformed })).toEqual({
      error: 'Response has no "answers" object.',
    });
  });
});
