import { describe, expect, it } from "vitest";
import { stripComments, stripJsonc, stripTrailingCommas } from "../../src/config/jsonc";

describe("jsonc를 검증함", () => {
  describe("stripComments 동작을 검증함", () => {
    it("한 줄 주석을 제거함을 검증함", () => {
      expect(stripComments('{"a":1} // comment\n{"b":2}')).toBe('{"a":1} \n{"b":2}');
    });
    it("문자열 안의 //를 보존함을 검증함", () => {
      expect(stripComments('{"a":"// not comment"}')).toBe('{"a":"// not comment"}');
    });
    it("블록 주석을 제거함을 검증함", () => {
      expect(stripComments('{"a":1} /* block */ {"b":2}')).toBe('{"a":1}  {"b":2}');
    });
    it("문자열 안의 /*를 보존함을 검증함", () => {
      expect(stripComments('{"a":"/* not block */"}')).toBe('{"a":"/* not block */"}');
    });
    it("문자열 안의 이스케이프된 따옴표를 처리함을 검증함", () => {
      expect(stripComments('{"a":"\\" // not comment"} // real')).toBe(
        '{"a":"\\" // not comment"} ',
      );
    });
    it("이스케이프된 백슬래시를 처리함을 검증함", () => {
      expect(stripComments('{"a":"\\\\"} // c\n')).toBe('{"a":"\\\\"} \n');
    });
    it("닫히지 않은 블록 주석 뒤 내용을 처리함을 검증함", () => {
      expect(stripComments('{"a":1/* comment')).toBe('{"a":1');
    });
    it("개행 포함 블록 주석을 처리함을 검증함", () => {
      expect(stripComments('{"a":1} /* multi\n line */ {"b":2}')).toBe('{"a":1}  {"b":2}');
    });
    it("개행 없는 EOF의 //를 처리함을 검증함", () => {
      expect(stripComments('{"a":1} // eof')).toBe('{"a":1} ');
    });
    it("여러 주석을 처리함을 검증함", () => {
      expect(stripComments('// first\n{"a":1} // second\n/* third */ {"b":2}')).toBe(
        '\n{"a":1} \n {"b":2}',
      );
    });
    it("빈 입력을 처리함을 검증함", () => expect(stripComments("")).toBe(""));
  });

  describe("stripTrailingCommas 동작을 검증함", () => {
    it("object의 후행 쉼표를 제거함을 검증함", () => {
      expect(stripTrailingCommas('{"a":1,}')).toBe('{"a":1}');
    });
    it("공백·개행 포함 후행 쉼표를 제거함을 검증함", () => {
      expect(stripTrailingCommas('{"a":1 , \n}')).toBe('{"a":1  \n}');
    });
    it("array의 후행 쉼표를 제거함을 검증함", () => {
      expect(stripTrailingCommas("[1,2,]")).toBe("[1,2]");
    });
    it("중첩된 여러 후행 쉼표를 제거함을 검증함", () => {
      expect(stripTrailingCommas('{"a":[1,],}')).toBe('{"a":[1]}');
    });
    it("문자열 안의 쉼표를 보존함을 검증함", () => {
      expect(stripTrailingCommas('{"a":"value, with comma",}')).toBe('{"a":"value, with comma"}');
    });
    it("괄호 포함 문자열 안의 쉼표를 보존함을 검증함", () => {
      expect(stripTrailingCommas('{"a":"},"}')).toBe('{"a":"},"}');
    });
    it("이스케이프된 따옴표를 처리함을 검증함", () => {
      expect(stripTrailingCommas('{"a":"\\"",}')).toBe('{"a":"\\""}');
    });
    it("후행이 아닌 쉼표는 제거하지 않음을 검증함", () => {
      expect(stripTrailingCommas('{"a":1,"b":2}')).toBe('{"a":1,"b":2}');
    });
    it("괄호 앞 공백을 처리함을 검증함", () => {
      expect(stripTrailingCommas('{"a":1,   }')).toBe('{"a":1   }');
    });
    it("빈 입력을 처리함을 검증함", () => expect(stripTrailingCommas("")).toBe(""));
    it("괄호 없는 EOF의 후행 쉼표는 유지함을 검증함", () => {
      expect(stripTrailingCommas('{"a":1,')).toBe('{"a":1,');
    });
    it("공백 포함 EOF의 후행 쉼표는 유지함을 검증함", () => {
      expect(stripTrailingCommas('{"a":1,   ')).toBe('{"a":1,   ');
    });
  });

  describe("stripJsonc 동작을 검증함", () => {
    it("주석과 후행 쉼표를 함께 제거함을 검증함", () => {
      expect(stripJsonc('{\n// comment\n"a":1, /* block */\n}')).toBe('{\n\n"a":1 \n}');
    });
    it("주석 제거 후 후행 쉼표를 처리함을 검증함", () => {
      expect(stripJsonc('{"a":1,} // comment\n')).toBe('{"a":1} \n');
    });
    it("//와 후행 쉼표 포함 문자열 내용을 보존함을 검증함", () => {
      expect(stripJsonc('{"a":"// ,",}')).toBe('{"a":"// ,"}');
    });
    it("유효한 JSON은 그대로 유지함을 검증함", () => {
      const json = '{"a":1,"b":[2,3]}';
      expect(stripJsonc(json)).toBe(json);
    });
  });
});
