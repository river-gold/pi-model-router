/* oxlint-disable */
import { describe, it, expect } from "vitest";
import {
  extractTextFromContent,
  getLastUserText,
  getHistoryPairsText,
  estimateTokens,
  truncateContext,
} from "./context";
import type { Context, Message } from "@earendil-works/pi-ai";

describe("context.ts", () => {
  describe("extractTextFromContent", () => {
    it("should return string directly", () => {
      expect(extractTextFromContent("hello")).toBe("hello");
    });
    it("should join text, thinking and toolCall parts", () => {
      const content: Message["content"] = [
        { type: "text" as const, text: "t1" },
        { type: "thinking" as const, thinking: "th" },
        { type: "toolCall" as const, id: "1", name: "fn", arguments: { a: 1 } },
      ];
      const r = extractTextFromContent(content);
      expect(r).toContain("t1");
      expect(r).toContain("th");
      expect(r).toContain("fn");
    });
  });

  describe("getLastUserText", () => {
    it("should return empty for no user", () => {
      expect(getLastUserText({ messages: [] })).toBe("");
    });
    it("should return last user text", () => {
      const ctx: Context = {
        messages: [
          { role: "user", content: "first", timestamp: 1 },
          {
            role: "assistant",
            content: "a",
            timestamp: 2,
          } as unknown as Message,
          { role: "user", content: "second", timestamp: 3 },
        ],
      };
      expect(getLastUserText(ctx)).toBe("second");
    });
  });

  describe("getHistoryPairsText", () => {
    it("should return empty for 0 or no history", () => {
      const ctx: Context = {
        messages: [{ role: "user", content: "hello", timestamp: 1 }],
      };
      expect(getHistoryPairsText(ctx, 0)).toBe("");
      expect(getHistoryPairsText(ctx, 1)).toBe("");
    });
    it("should return user+final pairs", () => {
      const ctx: Context = {
        messages: [
          { role: "user", content: "u1", timestamp: 1 },
          {
            role: "assistant",
            content: "a1",
            timestamp: 2,
          } as unknown as Message,
          { role: "user", content: "u2", timestamp: 3 },
          {
            role: "assistant",
            content: "a2",
            timestamp: 4,
          } as unknown as Message,
          { role: "user", content: "current", timestamp: 5 },
        ],
      };
      expect(getHistoryPairsText(ctx, 1)).toBe("u2\na2");
      expect(getHistoryPairsText(ctx, 2)).toBe("u1\na1\n---\nu2\na2");
    });
    it("should pick last toolResult as final if no assistant", () => {
      const ctx: Context = {
        messages: [
          { role: "user", content: "u1", timestamp: 1 },
          {
            role: "toolResult",
            toolCallId: "1",
            toolName: "t",
            content: "tool out",
            isError: false,
            timestamp: 2,
          } as unknown as Message,
          { role: "user", content: "current", timestamp: 3 },
        ],
      };
      expect(getHistoryPairsText(ctx, 1)).toBe("u1\ntool out");
    });
  });

  describe("estimateTokens", () => {
    it("should estimate", () => {
      expect(estimateTokens("abc")).toBe(1);
      expect(estimateTokens("a".repeat(6))).toBe(2);
    });
  });

  describe("truncateContext", () => {
    it("should truncate oldest to fit limit", () => {
      const ctx: Context = {
        systemPrompt: "sys",
        messages: [
          {
            role: "user",
            content: "a".repeat(3000),
            timestamp: 1,
          } as unknown as Message,
          {
            role: "user",
            content: "b".repeat(3000),
            timestamp: 2,
          } as unknown as Message,
          { role: "user", content: "c", timestamp: 3 } as unknown as Message,
        ],
      };
      const truncated = truncateContext(ctx, 10);
      expect(truncated.messages.length).toBeLessThan(ctx.messages.length);
      expect(
        (
          truncated.messages[truncated.messages.length - 1] as unknown as {
            content: string;
          }
        ).content,
      ).toBe("c");
    });
    it("should return same if within limit", () => {
      const ctx = {
        messages: [{ role: "user", content: "hi", timestamp: 1 }],
      } as unknown as Context;
      expect(truncateContext(ctx, 1000).messages.length).toBe(1);
    });
  });
});
