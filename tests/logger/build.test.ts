import { describe, expect, it } from "vitest";
import { buildLogLine } from "../../src/logger/build";
import type { ClassifierLogEntry } from "../../src/logger/types";

describe("logger/build 로그 라인 생성", () => {
  const base: ClassifierLogEntry = {
    timestamp: "2024-01-01T00:00:00Z",
    model: "openai/gpt-4o",
    thinking: "high",
    fullText: "hello world",
    tierLine: "tier: high",
    reasoningLine: "reason: test",
    parsedTier: "high",
    success: true,
    error: "some error",
  };

  it("모든 필드로 로그 라인을 생성한다", () => {
    const line = buildLogLine(base);
    expect(line).toContain("model=openai/gpt-4o");
    expect(line).toContain("thinking=high");
    expect(line).toContain("success=true");
    expect(line).toContain('tierLine="tier: high"');
    expect(line).toContain("parsedTier=high");
    expect(line).toContain("error=some error");
    expect(line).toContain('fullText="hello world"');
  });

  it("undefined 선택 필드는 기본값을 사용한다", () => {
    const entry: ClassifierLogEntry = {
      timestamp: "2024-01-01T00:00:00Z",
      model: "openai/gpt-4o",
      fullText: "hi",
      success: false,
    };
    const line = buildLogLine(entry);
    expect(line).toContain("thinking=-");
    expect(line).toContain('tierLine=""');
    expect(line).toContain('reasoningLine=""');
    expect(line).toContain("parsedTier=-");
    expect(line).toContain("error=-");
    expect(line).toContain("success=false");
  });

  it("빈 문자열과 undefined를 구분해 처리한다", () => {
    const entry: ClassifierLogEntry = {
      timestamp: "2024-01-01T00:00:00Z",
      model: "m",
      thinking: "",
      fullText: "x",
      tierLine: "",
      reasoningLine: "",
      parsedTier: "",
      success: true,
      error: "",
    };
    const line = buildLogLine(entry);
    // empty string is not nullish, so ?? does not fallback for "" (only undefined/null)
    expect(line).toContain("thinking=");
    expect(line).toContain("parsedTier=");
    expect(line).toContain("error=");
  });

  it("fullText를 4000자로 자른다", () => {
    const long = "a".repeat(5000);
    const entry: ClassifierLogEntry = {
      timestamp: "t",
      model: "m",
      fullText: long,
      success: true,
    };
    const line = buildLogLine(entry);
    // JSON.stringify of 4000 "a"s => 4002 with quotes
    expect(line).toContain("a".repeat(4000));
    expect(line).not.toContain("a".repeat(4001));
  });

  it("정확히 4000자는 자르지 않는다", () => {
    const exact = "a".repeat(4000);
    const entry: ClassifierLogEntry = {
      timestamp: "t",
      model: "m",
      fullText: exact,
      success: true,
    };
    expect(buildLogLine(entry)).toContain(exact);
  });

  it("JSON의 특수 문자를 처리한다", () => {
    const entry: ClassifierLogEntry = {
      timestamp: "t",
      model: "m",
      fullText: 'a\nb "c"',
      tierLine: "x\ny",
      success: true,
    };
    const line = buildLogLine(entry);
    expect(line).toContain(JSON.stringify('a\nb "c"'));
    expect(line).toContain(JSON.stringify("x\ny"));
  });
});
