import { describe, expect, it } from "vitest";
import { stripComments, stripJsonc, stripTrailingCommas } from "../../src/config/jsonc";

describe("jsonc", () => {
  describe("stripComments", () => {
    it("removes single line comments", () => {
      expect(stripComments('{"a":1} // comment\n{"b":2}')).toBe('{"a":1} \n{"b":2}');
    });
    it("preserves // inside string", () => {
      expect(stripComments('{"a":"// not comment"}')).toBe('{"a":"// not comment"}');
    });
    it("removes block comments", () => {
      expect(stripComments('{"a":1} /* block */ {"b":2}')).toBe('{"a":1}  {"b":2}');
    });
    it("preserves /* inside string", () => {
      expect(stripComments('{"a":"/* not block */"}')).toBe('{"a":"/* not block */"}');
    });
    it("handles escaped quotes inside string", () => {
      expect(stripComments('{"a":"\\" // not comment"} // real')).toBe(
        '{"a":"\\" // not comment"} ',
      );
    });
    it("handles escaped backslash", () => {
      expect(stripComments('{"a":"\\\\"} // c\n')).toBe('{"a":"\\\\"} \n');
    });
    it("handles block comment without closing, then content", () => {
      expect(stripComments('{"a":1/* comment')).toBe('{"a":1');
    });
    it("handles block comment with newline", () => {
      expect(stripComments('{"a":1} /* multi\n line */ {"b":2}')).toBe('{"a":1}  {"b":2}');
    });
    it("handles // at EOF without newline", () => {
      expect(stripComments('{"a":1} // eof')).toBe('{"a":1} ');
    });
    it("handles multiple comments", () => {
      expect(stripComments('// first\n{"a":1} // second\n/* third */ {"b":2}')).toBe(
        '\n{"a":1} \n {"b":2}',
      );
    });
    it("empty", () => expect(stripComments("")).toBe(""));
  });

  describe("stripTrailingCommas", () => {
    it("removes trailing comma in object", () => {
      expect(stripTrailingCommas('{"a":1,}')).toBe('{"a":1}');
    });
    it("removes trailing comma with whitespace and newline", () => {
      expect(stripTrailingCommas('{"a":1 , \n}')).toBe('{"a":1  \n}');
    });
    it("removes trailing comma in array", () => {
      expect(stripTrailingCommas('[1,2,]')).toBe('[1,2]');
    });
    it("removes multiple trailing commas nested", () => {
      expect(stripTrailingCommas('{"a":[1,],}')).toBe('{"a":[1]}');
    });
    it("preserves comma inside string", () => {
      expect(stripTrailingCommas('{"a":"value, with comma",}')).toBe('{"a":"value, with comma"}');
    });
    it("preserves comma inside string with bracket", () => {
      expect(stripTrailingCommas('{"a":"},"}')).toBe('{"a":"},"}');
    });
    it("handles escaped quotes", () => {
      expect(stripTrailingCommas('{"a":"\\"",}')).toBe('{"a":"\\""}');
    });
    it("does not remove non-trailing comma", () => {
      expect(stripTrailingCommas('{"a":1,"b":2}')).toBe('{"a":1,"b":2}');
    });
    it("handles whitespace before bracket", () => {
      expect(stripTrailingCommas('{"a":1,   }')).toBe('{"a":1   }');
    });
    it("empty", () => expect(stripTrailingCommas("")).toBe(""));
    it("trailing comma at EOF without bracket keeps comma", () => {
      expect(stripTrailingCommas('{"a":1,')).toBe('{"a":1,');
    });
    it("trailing comma with spaces at EOF keeps comma", () => {
      expect(stripTrailingCommas('{"a":1,   ')).toBe('{"a":1,   ');
    });
  });

  describe("stripJsonc", () => {
    it("strips both comments and trailing commas", () => {
      expect(stripJsonc('{\n// comment\n"a":1, /* block */\n}')).toBe('{\n\n"a":1 \n}');
    });
    it("handles trailing comma after comment removal", () => {
      expect(stripJsonc('{"a":1,} // comment\n')).toBe('{"a":1} \n');
    });
    it("preserves content inside string with // and trailing comma", () => {
      expect(stripJsonc('{"a":"// ,",}')).toBe('{"a":"// ,"}');
    });
    it("valid JSON unchanged", () => {
      const json = '{"a":1,"b":[2,3]}';
      expect(stripJsonc(json)).toBe(json);
    });
  });
});
