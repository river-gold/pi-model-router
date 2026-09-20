import { describe, it, expect } from "vitest";
import {
  extractTextFromContent,
  getLastUserText,
  getHistoryPairsText,
  getHistoryPairs,
  getCurrentTurnProgressText,
  estimateTokens,
  truncateContext,
} from "../src/context";
import type { Context } from "@earendil-works/pi-ai";
import { fakeMessage } from "./helpers";

describe("context.ts 컨텍스트는", () => {
  describe("extractTextFromContent 텍스트 추출은", () => {
    it("문자열을 그대로 반환한다", () => {
      expect(extractTextFromContent("hello")).toBe("hello");
    });
    it("text, thinking, toolCall 파트를 결합한다", () => {
      const content = [
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
          fakeMessage({ content: [{ type: "text", text: "a" }], timestamp: 2 }),
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
          fakeMessage({ content: [{ type: "text", text: "a1" }], timestamp: 2 }),
          { role: "user", content: "u2", timestamp: 3 },
          fakeMessage({ content: [{ type: "text", text: "a2" }], timestamp: 4 }),
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
            content: [{ type: "text", text: "tool out" }],
            isError: false,
            timestamp: 2,
          },
          { role: "user", content: "current", timestamp: 3 },
        ],
      };
      expect(getHistoryPairsText(ctx, 1)).toBe("u1\ntool out");
    });
  });

  describe("getHistoryPairs 히스토리 쌍 배열은", () => {
    it("pairCount가 0 이하면 빈 배열을 반환한다", () => {
      const ctx: Context = { messages: [{ role: "user", content: "hello", timestamp: 1 }] };
      expect(getHistoryPairs(ctx, 0)).toEqual([]);
      expect(getHistoryPairs(ctx, -1)).toEqual([]);
    });
    it("user+final 쌍을 배열로 반환한다", () => {
      const ctx: Context = {
        messages: [
          { role: "user", content: "u1", timestamp: 1 },
          fakeMessage({ content: [{ type: "text", text: "a1" }], timestamp: 2 }),
          { role: "user", content: "u2", timestamp: 3 },
          fakeMessage({ content: [{ type: "text", text: "a2" }], timestamp: 4 }),
          { role: "user", content: "current", timestamp: 5 },
        ],
      };
      expect(getHistoryPairs(ctx, 2)).toEqual(["u1\na1", "u2\na2"]);
      expect(getHistoryPairsText(ctx, 2)).toBe("u1\na1\n---\nu2\na2");
    });
  });

  describe("getCurrentTurnProgressText 현재 턴 진행상황은", () => {
    it("마지막 메시지가 user이면(일반 유저 턴) 빈 문자열을 반환한다", () => {
      const ctx: Context = {
        messages: [
          { role: "user", content: "u1", timestamp: 1 },
          fakeMessage({ content: [{ type: "text", text: "a1" }], timestamp: 2 }),
          { role: "user", content: "current", timestamp: 3 },
        ],
      };
      expect(getCurrentTurnProgressText(ctx)).toBe("");
    });
    it("user 메시지가 없으면 빈 문자열을 반환한다", () => {
      const ctx: Context = {
        messages: [fakeMessage({ content: [{ type: "text", text: "a1" }], timestamp: 1 })],
      };
      expect(getCurrentTurnProgressText(ctx)).toBe("");
    });
    it("툴 루프 중이면 마지막 user 이후의 최신 assistant/toolResult 텍스트를 반환한다", () => {
      const ctx: Context = {
        messages: [
          { role: "user", content: "do it", timestamp: 1 },
          fakeMessage({ content: [{ type: "text", text: "step1" }], timestamp: 2 }),
          {
            role: "toolResult",
            toolCallId: "1",
            toolName: "t",
            content: [{ type: "text", text: "tool out" }],
            isError: false,
            timestamp: 3,
          },
        ],
      };
      expect(getCurrentTurnProgressText(ctx)).toBe("tool out");
    });
    it("상한 초과 시 뒤쪽만 남긴다", () => {
      const long = "x".repeat(4200);
      const ctx: Context = {
        messages: [
          { role: "user", content: "do it", timestamp: 1 },
          fakeMessage({ content: [{ type: "text", text: long }], timestamp: 2 }),
        ],
      };
      const r = getCurrentTurnProgressText(ctx);
      expect(r.length).toBe(4000);
      expect(r.endsWith(long.slice(-4000))).toBe(true);
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
          { role: "user", content: "a".repeat(3000), timestamp: 1 },
          { role: "user", content: "b".repeat(3000), timestamp: 2 },
          { role: "user", content: "c", timestamp: 3 },
        ],
      };
      const truncated = truncateContext(ctx, 10);
      expect(truncated.messages.length).toBeLessThan(ctx.messages.length);
      expect(truncated.messages[truncated.messages.length - 1]!.content).toBe("c");
    });
    it("limit 이내이면 그대로 반환한다", () => {
      const ctx: Context = {
        messages: [{ role: "user", content: "hi", timestamp: 1 }],
      };
      expect(truncateContext(ctx, 1000).messages.length).toBe(1);
    });
  });
});
