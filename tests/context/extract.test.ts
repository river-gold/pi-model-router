import { describe, expect, it } from "vitest";
import { extractPartText, extractTextFromContent } from "../../src/context/extract";

describe("extract", () => {
  describe("extractPartText", () => {
    it("text", () => {
      expect(extractPartText({ type: "text", text: "hello" } as any)).toBe("hello");
    });
    it("thinking", () => {
      expect(extractPartText({ type: "thinking", thinking: "think" } as any)).toBe("think");
    });
    it("toolCall", () => {
      expect(extractPartText({ type: "toolCall", name: "fn", arguments: { a: 1 } } as any)).toBe(
        'fn {"a":1}',
      );
    });
    it("toolCall with empty args", () => {
      expect(extractPartText({ type: "toolCall", name: "fn", arguments: {} } as any)).toBe("fn {}");
    });
    it("unknown type returns empty", () => {
      expect(extractPartText({ type: "image", url: "x" } as any)).toBe("");
      expect(extractPartText({ type: "toolResult", toolCallId: "1" } as any)).toBe("");
    });
  });

  describe("extractTextFromContent", () => {
    it("string", () => expect(extractTextFromContent("hello")).toBe("hello"));
    it("empty string", () => expect(extractTextFromContent("")).toBe(""));
    it("array text", () =>
      expect(extractTextFromContent([{ type: "text", text: "a" } as any])).toBe("a"));
    it("array with empty parts filtered", () => {
      const content = [
        { type: "text", text: "" } as any,
        { type: "image", url: "x" } as any,
        { type: "text", text: "b" } as any,
      ];
      expect(extractTextFromContent(content)).toBe("b");
    });
    it("array empty", () => expect(extractTextFromContent([] as any)).toBe(""));
    it("array multiple with thinking and toolCall", () => {
      const content = [
        { type: "text", text: "t" } as any,
        { type: "thinking", thinking: "th" } as any,
        { type: "toolCall", name: "fn", arguments: { x: 1 } } as any,
      ];
      expect(extractTextFromContent(content)).toBe('t\nth\nfn {"x":1}');
    });
    it("array all empty returns empty", () => {
      expect(
        extractTextFromContent([
          { type: "image", url: "x" } as any,
          { type: "text", text: "" } as any,
        ]),
      ).toBe("");
    });
  });
});
