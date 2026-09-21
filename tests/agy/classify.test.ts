import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "@earendil-works/pi-ai";
import {
  AGY_TIER_JSON_SCHEMA,
  buildAgyClassifierPrompt,
  classifyWithAgy,
  getSharedAgyClassifierPool,
  parseAgyClassifierResult,
  parseAgyClassifierTier,
} from "../../src/agy/classify";
import { AgyClassifierPool } from "../../src/agy/pool";
import type * as ModelsModule from "../../src/agy/models";
import type { TierGuides } from "../../src/types";

const { mockLoadAgyMeta, mockPoolRun } = vi.hoisted(() => ({
  mockLoadAgyMeta: vi.fn(),
  mockPoolRun: vi.fn(),
}));

vi.mock("../../src/agy/models", async () => {
  const actual = await vi.importActual<typeof ModelsModule>("../../src/agy/models");
  return { ...actual, loadAgyMeta: mockLoadAgyMeta };
});

const ctx: Context = { messages: [{ role: "user", content: "hi", timestamp: 1 }] };

const baseParams = {
  context: ctx,
  model: "gemini-3.7-flash",
  historySize: 0,
  cwd: "/cwd",
  pool: { run: mockPoolRun },
};

describe("parseAgyClassifierTier 텍스트 파싱을 검증함", () => {
  it("tier 한 단어 응답을 그대로 파싱함을 검증함", () => {
    expect(parseAgyClassifierTier("high")).toBe("high");
    expect(parseAgyClassifierTier("  MAX\n")).toBe("max");
  });

  it("설명이 섞인 응답에서 마지막 tier 단어를 찾음을 검증함", () => {
    expect(parseAgyClassifierTier("This looks like a medium task.\nTier: **high**")).toBe("high");
    expect(parseAgyClassifierTier("low or medium? medium.")).toBe("medium");
  });

  it("tier 단어가 없으면 undefined를 반환함을 검증함", () => {
    expect(parseAgyClassifierTier("")).toBeUndefined();
    expect(parseAgyClassifierTier("I cannot classify this")).toBeUndefined();
    expect(parseAgyClassifierTier("higher lower")).toBeUndefined();
  });
});

describe("parseAgyClassifierResult 구조화 출력 파싱을 검증함", () => {
  it("json-schema 결과의 tier를 최우선으로 씀을 검증함", () => {
    expect(parseAgyClassifierResult('{"tier":"xhigh"}')).toBe("xhigh");
    expect(parseAgyClassifierResult('  {"tier":"low","reason":"r"}  ')).toBe("low");
  });

  it("JSON이지만 tier가 유효하지 않으면 텍스트 스캔으로 폴백함을 검증함", () => {
    expect(parseAgyClassifierResult('{"tier":"bogus"}')).toBeUndefined();
    expect(parseAgyClassifierResult('{"tier":123}')).toBeUndefined();
    expect(parseAgyClassifierResult('{"tier":"bogus"} high')).toBe("high");
  });

  it("JSON이 아니면 텍스트 스캔으로 폴백함을 검증함", () => {
    expect(parseAgyClassifierResult("Tier: high")).toBe("high");
    expect(parseAgyClassifierResult("no idea")).toBeUndefined();
  });
});

describe("buildAgyClassifierPrompt 프롬프트 구성을 검증함", () => {
  it("tier 가이드와 제약, 최신 user 메시지를 포함함을 검증함", () => {
    const tierGuides: TierGuides = { high: "Local design work" };
    const prompt = buildAgyClassifierPrompt(ctx, 0, tierGuides);
    expect(prompt).toContain("Local design work");
    expect(prompt).toContain("Output ONLY one word");
    expect(prompt).toContain("Latest user message:");
    expect(prompt).toContain("hi");
  });
});

describe("classifyWithAgy 분류 실행을 검증함", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadAgyMeta.mockResolvedValue(undefined);
  });

  it("variant 해석 실패 시 pool 호출 없이 error를 반환함을 검증함", async () => {
    mockLoadAgyMeta.mockResolvedValue({
      "gemini-3.7-flash": { variants: ["high", "low"], defaultVariant: "high" },
    });
    const outcome = await classifyWithAgy({ ...baseParams, effort: "medium" });
    expect(outcome).toEqual({
      error: 'agy model "gemini-3.7-flash" has no variant "medium" (variants: high, low)',
    });
    expect(mockPoolRun).not.toHaveBeenCalled();
  });

  it("실행 실패 시 agy classifier failed error를 반환함을 검증함", async () => {
    mockPoolRun.mockResolvedValue({ error: "timed out" });
    const outcome = await classifyWithAgy(baseParams);
    expect(outcome).toEqual({ error: "agy classifier failed: timed out" });
  });

  it("abort는 그대로 aborted error를 반환함을 검증함", async () => {
    mockPoolRun.mockResolvedValue({ error: "aborted" });
    const outcome = await classifyWithAgy(baseParams);
    expect(outcome).toEqual({ error: "aborted" });
  });

  it("tier를 못 찾으면 잘린 출력을 담은 error를 반환함을 검증함", async () => {
    mockPoolRun.mockResolvedValue({ text: "x".repeat(300) });
    const outcome = await classifyWithAgy(baseParams);
    expect(outcome).toEqual({ error: `no tier in agy output: ${"x".repeat(200)}…` });
  });

  it("짧은 non-tier 출력도 그대로 담아 error를 반환함을 검증함", async () => {
    mockPoolRun.mockResolvedValue({ text: "I cannot classify" });
    const outcome = await classifyWithAgy(baseParams);
    expect(outcome).toEqual({ error: "no tier in agy output: I cannot classify" });
  });

  it("성공하면 tier를 반환하고 json-schema 포함 인자로 pool을 호출함을 검증함", async () => {
    mockLoadAgyMeta.mockResolvedValue({
      "gemini-3.7-flash": { variants: ["high", "medium", "low"], defaultVariant: "high" },
    });
    mockPoolRun.mockResolvedValue({ text: '{"tier":"medium"}' });
    const outcome = await classifyWithAgy({
      ...baseParams,
      effort: "low",
      tierGuides: { low: "Cheap work" },
    });
    expect(outcome).toEqual({ result: { tier: "medium", reasoning: "Classifier decision." } });
    const params = mockPoolRun.mock.calls[0][0];
    expect(params.key).toBe("gemini-3.7-flash-low\u0000");
    expect(params.prompt).toContain("Cheap work");
    expect(params.timeoutMs).toBe(300_000);
    expect(params.cwd).toBe("/cwd");
    expect(params.args).toEqual([
      "--add-dir",
      "/cwd",
      "--model",
      "gemini-3.7-flash-low",
      "--json-schema",
      AGY_TIER_JSON_SCHEMA,
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
    ]);
  });

  it("캐시가 없으면 모델 id 그대로 + --effort 플래그로 실행함을 검증함", async () => {
    mockPoolRun.mockResolvedValue({ text: "low" });
    await classifyWithAgy({ ...baseParams, effort: "low" });
    const params = mockPoolRun.mock.calls[0][0];
    expect(params.key).toBe("gemini-3.7-flash\u0000low");
    expect(params.args).toContain("gemini-3.7-flash");
    expect(params.args).not.toContain("gemini-3.7-flash-low");
    expect(params.args).toContain("--effort");
  });

  it("env로 binary/타임아웃/풀링 시간을 바꿈을 검증함", async () => {
    mockPoolRun.mockResolvedValue({ text: "low" });
    await classifyWithAgy({
      ...baseParams,
      env: {
        AGY_BINARY: "custom-agy",
        AGY_TIMEOUT_MS: "1234",
        AGY_CLASSIFIER_IDLE_MS: "7777",
      },
    });
    expect(mockPoolRun).toHaveBeenCalledWith(
      expect.objectContaining({ binary: "custom-agy", timeoutMs: 1234 }),
    );
  });

  it("pool 미지정 시 공유 풀을 만들어 재사용함을 검증함", async () => {
    const realPool = getSharedAgyClassifierPool({ idleMs: 1111, maxEntries: 2 });
    expect(getSharedAgyClassifierPool({ idleMs: 1111, maxEntries: 2 })).toBe(realPool);
    expect(realPool).toBeInstanceOf(AgyClassifierPool);

    const runSpy = vi.spyOn(realPool, "run").mockResolvedValue({ text: "low" });
    await classifyWithAgy({ context: ctx, model: "m", historySize: 0, cwd: "/cwd" });
    await classifyWithAgy({ context: ctx, model: "m", historySize: 0, cwd: "/cwd" });
    expect(runSpy).toHaveBeenCalledTimes(2);
    realPool.disposeAll();
  });
});
