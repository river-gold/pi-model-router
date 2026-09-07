import { describe, expect, it } from "vitest";
import { extractPartText, extractTextFromContent } from "../../src/context/extract";

describe("extract 텍스트 추출", () => {
  describe("extractPartText 파트 텍스트 추출", () => {
    it("text 타입을 추출한다", () => {
      expect(extractPartText({ type: "text", text: "hello" } as any)).toBe("hello");
    });
    it("thinking 타입을 추출한다", () => {
      expect(extractPartText({ type: "thinking", thinking: "think" } as any)).toBe("think");
    });
    it("toolCall 이름과 arguments를 함께 추출한다", () => {
      expect(extractPartText({ type: "toolCall", name: "fn", arguments: { a: 1 } } as any)).toBe(
        'fn {"a":1}',
      );
    });
    it("arguments가 빈 toolCall을 추출한다", () => {
      expect(extractPartText({ type: "toolCall", name: "fn", arguments: {} } as any)).toBe("fn {}");
    });
    it("알 수 없는 타입은 빈 문자열을 반환한다", () => {
      expect(extractPartText({ type: "image", url: "x" } as any)).toBe("");
      expect(extractPartText({ type: "toolResult", toolCallId: "1" } as any)).toBe("");
    });
  });

  describe("extractTextFromContent 콘텐츠 텍스트 추출", () => {
    it("문자열을 그대로 반환한다", () => expect(extractTextFromContent("hello")).toBe("hello"));
    it("빈 문자열을 반환한다", () => expect(extractTextFromContent("")).toBe(""));
    it("배열의 text 파트를 추출한다", () =>
      expect(extractTextFromContent([{ type: "text", text: "a" } as any])).toBe("a"));
    it("빈 파트를 제외하고 추출한다", () => {
      const content = [
        { type: "text", text: "" } as any,
        { type: "image", url: "x" } as any,
        { type: "text", text: "b" } as any,
      ];
      expect(extractTextFromContent(content)).toBe("b");
    });
    it("빈 배열은 빈 문자열을 반환한다", () => expect(extractTextFromContent([] as any)).toBe(""));
    it("thinking과 toolCall이 섞인 배열을 줄바꿈으로 결합한다", () => {
      const content = [
        { type: "text", text: "t" } as any,
        { type: "thinking", thinking: "th" } as any,
        { type: "toolCall", name: "fn", arguments: { x: 1 } } as any,
      ];
      expect(extractTextFromContent(content)).toBe('t\nth\nfn {"x":1}');
    });
    it("모두 빈 파트면 빈 문자열을 반환한다", () => {
      expect(
        extractTextFromContent([
          { type: "image", url: "x" } as any,
          { type: "text", text: "" } as any,
        ]),
      ).toBe("");
    });
  });
});
