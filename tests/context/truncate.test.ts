import { describe, expect, it } from "vitest";
import {
  alignToUserBoundary,
  calculateMessageTokens,
  calculateSystemTokens,
  countLeadingOrphanToolResults,
  findStartIndex,
  truncateContext,
} from "../../src/context/truncate";
import type { Context, Message } from "@earendil-works/pi-ai";

const m = (role: string, content: string): Message => ({ role, content }) as unknown as Message;

describe("truncate 헬퍼 함수들", () => {
  describe("calculateSystemTokens 시스템 토큰 계산", () => {
    it("undefined면 0을 반환한다", () => expect(calculateSystemTokens(undefined)).toBe(0));
    it("빈 문자열이면 0을 반환한다", () => expect(calculateSystemTokens("")).toBe(0));
    it("비어 있지 않으면 토큰을 계산한다", () => expect(calculateSystemTokens("abc")).toBe(1));
    it("긴 문자열의 토큰을 계산한다", () => expect(calculateSystemTokens("a".repeat(6))).toBe(2));
  });

  describe("calculateMessageTokens 메시지 토큰 계산", () => {
    it("빈 배열이면 빈 배열을 반환한다", () => expect(calculateMessageTokens([])).toEqual([]));
    it("각 메시지의 토큰을 매핑한다", () =>
      expect(calculateMessageTokens([m("user", "abc"), m("assistant", "a".repeat(6))])).toEqual([
        1, 2,
      ]));
  });

  describe("findStartIndex 시작 인덱스 탐색", () => {
    it("제한 이내면 0을 반환한다", () => {
      const msgs = [m("user", "a"), m("assistant", "b")];
      const tokens = [1, 1];
      expect(findStartIndex(msgs, tokens, 0, 1, 10)).toBe(0);
    });
    it("하나를 버려야 하면 1씩 이동한다", () => {
      const msgs = [m("user", "a".repeat(30)), m("user", "b".repeat(30))];
      const tokens = [10, 10];
      // system 0 + latest 10 + activeSum 20=30 >10, drop first ->10, still 20>10, drop second ->0, 10<=10 => need drop all =>2
      // use limit 20 to need drop one: 0+10+20=30>20 drop first =>0+10+10=20<=20 =>1
      expect(findStartIndex(msgs, tokens, 0, 10, 20)).toBe(1);
      expect(findStartIndex(msgs, tokens, 0, 10, 10)).toBe(2);
    });
    it("전부를 버려야 하면 끝 인덱스를 반환한다", () => {
      const msgs = [m("user", "a".repeat(30))];
      const tokens = [10];
      expect(findStartIndex(msgs, tokens, 0, 10, 5)).toBe(1);
    });
    it("빈 메시지 배열이면 0을 반환한다", () => expect(findStartIndex([], [], 0, 0, 10)).toBe(0));
    it("systemTokens을 포함해 계산한다", () => {
      const msgs = [m("user", "a".repeat(30))];
      const tokens = [10];
      expect(findStartIndex(msgs, tokens, 5, 10, 14)).toBe(1); // 5+10+10=25 >14 drop -> 5+10+0=15 >14 -> 1
      expect(findStartIndex(msgs, tokens, 5, 10, 15)).toBe(1); // 5+10+0=15 <=15
      expect(findStartIndex(msgs, tokens, 0, 10, 20)).toBe(0);
    });
  });

  describe("alignToUserBoundary user 경계 정렬", () => {
    it("start가 길이 이상이면 start를 그대로 반환한다", () =>
      expect(alignToUserBoundary([m("user", "a")], 1)).toBe(1));
    it("빈 배열이면 0을 반환한다", () => expect(alignToUserBoundary([], 0)).toBe(0));
    it("이미 user 위치면 그대로 유지한다", () =>
      expect(alignToUserBoundary([m("assistant", "a"), m("user", "b")], 1)).toBe(1));
    it("다음 user 위치로 정렬한다", () =>
      expect(
        alignToUserBoundary([m("assistant", "a"), m("assistant", "b"), m("user", "c")], 0),
      ).toBe(2));
    it("user가 없으면 startIndex를 반환한다", () =>
      expect(alignToUserBoundary([m("assistant", "a"), m("assistant", "b")], 0)).toBe(0));
    it("이후 user가 없으면 startIndex를 반환한다", () =>
      expect(
        alignToUserBoundary([m("user", "a"), m("assistant", "b"), m("assistant", "c")], 1),
      ).toBe(1));
  });

  describe("countLeadingOrphanToolResults 앞쪽 고아 toolResult 개수", () => {
    it("빈 배열이면 0을 반환한다", () => expect(countLeadingOrphanToolResults([])).toBe(0));
    it("고아가 없으면 0을 반환한다", () =>
      expect(countLeadingOrphanToolResults([m("user", "a")])).toBe(0));
    it("고아 toolResult 하나를 센다", () =>
      expect(countLeadingOrphanToolResults([m("toolResult", "a") as any])).toBe(1));
    it("고아 toolResult 두 개를 센다", () =>
      expect(
        countLeadingOrphanToolResults([m("toolResult", "a") as any, m("toolResult", "b") as any]),
      ).toBe(2));
    it("고아 뒤 user에서 멈춘다", () =>
      expect(countLeadingOrphanToolResults([m("toolResult", "a") as any, m("user", "b")])).toBe(1));
    it("고아 뒤 assistant는 고아로 세지 않는다", () =>
      expect(
        countLeadingOrphanToolResults([m("toolResult", "a") as any, m("assistant", "b")]),
      ).toBe(1));
    it("첫 메시지가 고아가 아니면 0을 반환한다", () =>
      expect(
        countLeadingOrphanToolResults([m("assistant", "a"), m("toolResult", "b") as any]),
      ).toBe(0));
  });

  describe("truncateContext 컨텍스트 자르기", () => {
    it("메시지 하나면 그대로 반환한다", () => {
      const ctx = { messages: [m("user", "hi")] } as unknown as Context;
      expect(truncateContext(ctx, 0)).toBe(ctx);
    });
    it("빈 메시지 배열이면 그대로 반환한다", () => {
      const ctx = { messages: [] } as unknown as Context;
      expect(truncateContext(ctx, 10)).toBe(ctx);
    });
    it("제한 이내면 그대로 반환한다", () => {
      const ctx = { messages: [m("user", "hi"), m("assistant", "hello")] } as unknown as Context;
      expect(truncateContext(ctx, 1000)).toBe(ctx);
    });
    it("systemPrompt가 제한 이내면 메시지를 유지한다", () => {
      const ctx = {
        systemPrompt: "sys",
        messages: [m("user", "hi")],
      } as unknown as Context;
      // single message + sys still returns as-is per <=1 check
      expect(truncateContext(ctx, 1000).messages.length).toBe(1);
    });
    it("제한에 맞게 가장 오래된 메시지부터 자른다", () => {
      const ctx: Context = {
        systemPrompt: "sys",
        messages: [
          m("user", "a".repeat(3000)),
          m("user", "b".repeat(3000)),
          m("user", "c"),
        ] as unknown as Context,
      };
      const truncated = truncateContext(ctx, 10);
      expect(truncated.messages.length).toBeLessThan(ctx.messages.length);
      expect((truncated.messages[truncated.messages.length - 1] as any).content).toBe("c");
    });
    it("user 경계에 맞춰 자른다", () => {
      const ctx: Context = {
        messages: [
          m("assistant", "a".repeat(3000)),
          m("user", "b".repeat(3000)),
          m("user", "c"),
        ] as unknown as Context,
      };
      const truncated = truncateContext(ctx, 10);
      // should drop leading assistant and align to user
      expect(truncated.messages[0].role).toBe("user");
    });
    it("고아 toolResult를 버린다", () => {
      const ctx2: Context = {
        messages: [
          m("assistant", "x".repeat(3000)),
          { role: "toolResult", content: "orphan", toolCallId: "1" } as unknown as Message,
          m("user", "final"),
        ] as unknown as Context,
      };
      const truncated = truncateContext(ctx2, 5);
      if (truncated.messages.length > 0) {
        expect(truncated.messages[0].role).not.toBe("toolResult");
      }
    });
    it("유지 구간에 user가 없으면 앞쪽 고아 toolResult들을 버린다", () => {
      const ctx: Context = {
        messages: [
          { role: "toolResult", content: "a", toolCallId: "1" } as unknown as Message,
          { role: "toolResult", content: "b", toolCallId: "2" } as unknown as Message,
          m("user", "final"),
        ] as unknown as Context,
      };
      // system 0, messages 3 tokens ~1+1+1=3, limit 2 => need to drop first toolResult(s) but keep orphan handling
      const truncated = truncateContext(ctx, 2);
      // should have dropped leading orphans, so first message is final user
      expect(truncated.messages[0].role).toBe("user");
      expect((truncated.messages[0] as any).content).toBe("final");
    });
    it("orphanCount가 0이면 메시지를 유지한다", () => {
      const ctx: Context = {
        messages: [m("user", "a"), m("assistant", "b"), m("user", "final")],
      } as unknown as Context;
      const truncated = truncateContext(ctx, 1000);
      expect(truncated).toBe(ctx); // within limit, no truncation
    });
    it("최신 메시지는 항상 보존한다", () => {
      const ctx: Context = {
        messages: [m("user", "a".repeat(100)), m("user", "b".repeat(100)), m("user", "keep")],
      } as unknown as Context;
      const truncated = truncateContext(ctx, 1);
      expect((truncated.messages[truncated.messages.length - 1] as any).content).toBe("keep");
    });
    it("systemPrompt 토큰을 포함해 계산한다", () => {
      const ctx: Context = {
        systemPrompt: "a".repeat(300),
        messages: [m("user", "a".repeat(100)), m("user", "keep")],
      } as unknown as Context;
      // system 100 tokens + messages ~ 34+2, limit 10 should truncate
      const truncated = truncateContext(ctx, 10);
      expect(truncated.messages.length).toBeLessThan(ctx.messages.length);
    });
  });
});
