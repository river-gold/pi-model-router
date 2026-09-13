import { describe, expect, it } from "vitest";
import { parseJsonc } from "../../src/config/parse-jsonc";

describe("parseJsonc를 검증함", () => {
  it("주석과 후행 쉼표를 허용함을 검증함", () => {
    expect(parseJsonc('{\n// comment\n"a": 1, /* block */\n}')).toEqual({ a: 1 });
  });
  it("유효한 JSON을 그대로 파싱함을 검증함", () => {
    expect(parseJsonc('{"a":1,"b":[2,3]}')).toEqual({ a: 1, b: [2, 3] });
  });
  it("무효한 입력에 예외를 던짐을 검증함", () => {
    expect(() => parseJsonc("{invalid")).toThrow(/invalid JSONC/);
  });
  it("빈 입력에 예외를 던짐을 검증함", () => {
    expect(() => parseJsonc("")).toThrow(/invalid JSONC/);
  });
});
