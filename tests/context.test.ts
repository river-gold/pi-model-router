/* oxlint-disable */
import { describe, it, expect } from "vitest";
import {
  extractTextFromContent,
  getLastUserText,
  getHistoryPairsText,
  estimateTokens,
  truncateContext,
} from "../src/context";
import type { Context, Message } from "@earendil-works/pi-ai";

describe("context.ts 컨텍스트는", () => {
  describe("extractTextFromContent 텍스트 추출은", () => {
    it("문자열을 그대로 반환한다", () => {
      expect(extractTextFromContent("hello")).toBe("hello");
    });
    it("text, thinking, toolCall 파트를 결합한다", () => {
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

  describe("getLastUserText 마지막 사용자 텍스트는", () => {
    it("user가 없으면 빈 문자열을 반환한다", () => {
      expect(getLastUserText({ messages: [] })).toBe("");
    });
    it("마지막 user 텍스트를 반환한다", () => {
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

  describe("getHistoryPairsText 히스토리 쌍 텍스트는", () => {
    it("0이거나 history가 없으면 빈 문자열을 반환한다", () => {
      const ctx: Context = {
        messages: [{ role: "user", content: "hello", timestamp: 1 }],
      };
      expect(getHistoryPairsText(ctx, 0)).toBe("");
      expect(getHistoryPairsText(ctx, 1)).toBe("");
    });
    it("user+final 쌍을 반환한다", () => {
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
    it("assistant가 없으면 마지막 toolResult를 final로 선택한다", () => {
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

  describe("estimateTokens 토큰 추정은", () => {
    it("토큰 수를 추정한다", () => {
      expect(estimateTokens("abc")).toBe(1);
      expect(estimateTokens("a".repeat(6))).toBe(2);
    });
  });

  describe("truncateContext 컨텍스트 잘라내기는", () => {
    it("limit에 맞게 가장 오래된 메시지부터 잘라낸다", () => {
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
    it("limit 이내이면 그대로 반환한다", () => {
      const ctx = {
        messages: [{ role: "user", content: "hi", timestamp: 1 }],
      } as unknown as Context;
      expect(truncateContext(ctx, 1000).messages.length).toBe(1);
    });
  });
});
