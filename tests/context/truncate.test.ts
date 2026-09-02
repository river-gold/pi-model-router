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

const m = (role: string, content: string): Message => ({ role, content } as unknown as Message);

describe("truncate helpers", () => {
  describe("calculateSystemTokens", () => {
    it("undefined -> 0", () => expect(calculateSystemTokens(undefined)).toBe(0));
    it("empty -> 0", () => expect(calculateSystemTokens("")).toBe(0));
    it("non-empty", () => expect(calculateSystemTokens("abc")).toBe(1));
    it("long", () => expect(calculateSystemTokens("a".repeat(6))).toBe(2));
  });

  describe("calculateMessageTokens", () => {
    it("empty", () => expect(calculateMessageTokens([])).toEqual([]));
    it("maps", () =>
      expect(calculateMessageTokens([m("user", "abc"), m("assistant", "a".repeat(6))])).toEqual([
        1, 2,
      ]));
  });

  describe("findStartIndex", () => {
    it("already within limit -> 0", () => {
      const msgs = [m("user", "a"), m("assistant", "b")];
      const tokens = [1, 1];
      expect(findStartIndex(msgs, tokens, 0, 1, 10)).toBe(0);
    });
    it("needs to drop one", () => {
      const msgs = [m("user", "a".repeat(30)), m("user", "b".repeat(30))];
      const tokens = [10, 10];
      // system 0 + latest 10 + activeSum 20=30 >10, drop first ->10, still 20>10, drop second ->0, 10<=10 => need drop all =>2
      // use limit 20 to need drop one: 0+10+20=30>20 drop first =>0+10+10=20<=20 =>1
      expect(findStartIndex(msgs, tokens, 0, 10, 20)).toBe(1);
      expect(findStartIndex(msgs, tokens, 0, 10, 10)).toBe(2);
    });
    it("needs to drop all", () => {
      const msgs = [m("user", "a".repeat(30))];
      const tokens = [10];
      expect(findStartIndex(msgs, tokens, 0, 10, 5)).toBe(1);
    });
    it("empty messages -> 0", () => expect(findStartIndex([], [], 0, 0, 10)).toBe(0));
    it("with systemTokens", () => {
      const msgs = [m("user", "a".repeat(30))];
      const tokens = [10];
      expect(findStartIndex(msgs, tokens, 5, 10, 14)).toBe(1); // 5+10+10=25 >14 drop -> 5+10+0=15 >14 -> 1
      expect(findStartIndex(msgs, tokens, 5, 10, 15)).toBe(1); // 5+10+0=15 <=15
      expect(findStartIndex(msgs, tokens, 0, 10, 20)).toBe(0);
    });
  });

  describe("alignToUserBoundary", () => {
    it("start >= length -> return start", () =>
      expect(alignToUserBoundary([m("user", "a")], 1)).toBe(1));
    it("empty -> 0", () => expect(alignToUserBoundary([], 0)).toBe(0));
    it("already at user -> same", () =>
      expect(alignToUserBoundary([m("assistant", "a"), m("user", "b")], 1)).toBe(1));
    it("aligns to next user", () =>
      expect(alignToUserBoundary([m("assistant", "a"), m("assistant", "b"), m("user", "c")], 0)).toBe(
        2,
      ));
    it("no user found -> startIndex", () =>
      expect(alignToUserBoundary([m("assistant", "a"), m("assistant", "b")], 0)).toBe(0));
    it("start 1 no user after -> startIndex", () =>
      expect(alignToUserBoundary([m("user", "a"), m("assistant", "b"), m("assistant", "c")], 1)).toBe(1));
  });

  describe("countLeadingOrphanToolResults", () => {
    it("empty ->0", () => expect(countLeadingOrphanToolResults([])).toBe(0));
    it("no orphan", () => expect(countLeadingOrphanToolResults([m("user", "a")])).toBe(0));
    it("single orphan", () =>
      expect(countLeadingOrphanToolResults([m("toolResult", "a") as any])).toBe(1));
    it("two orphans", () =>
      expect(
        countLeadingOrphanToolResults([m("toolResult", "a") as any, m("toolResult", "b") as any]),
      ).toBe(2));
    it("orphan + user stops", () =>
      expect(
        countLeadingOrphanToolResults([m("toolResult", "a") as any, m("user", "b")]),
      ).toBe(1));
    it("orphan + assistant not counted as orphan? assistant not toolResult", () =>
      expect(
        countLeadingOrphanToolResults([m("toolResult", "a") as any, m("assistant", "b")]),
      ).toBe(1));
    it("non-orphan first ->0", () =>
      expect(countLeadingOrphanToolResults([m("assistant", "a"), m("toolResult", "b") as any])).toBe(
        0,
      ));
  });

  describe("truncateContext", () => {
    it("single message -> return as-is", () => {
      const ctx = { messages: [m("user", "hi")] } as unknown as Context;
      expect(truncateContext(ctx, 0)).toBe(ctx);
    });
    it("empty messages -> return as-is", () => {
      const ctx = { messages: [] } as unknown as Context;
      expect(truncateContext(ctx, 10)).toBe(ctx);
    });
    it("within limit -> return as-is", () => {
      const ctx = { messages: [m("user", "hi"), m("assistant", "hello")] } as unknown as Context;
      expect(truncateContext(ctx, 1000)).toBe(ctx);
    });
    it("systemPrompt within limit", () => {
      const ctx = {
        systemPrompt: "sys",
        messages: [m("user", "hi")],
      } as unknown as Context;
      // single message + sys still returns as-is per <=1 check
      expect(truncateContext(ctx, 1000).messages.length).toBe(1);
    });
    it("truncates oldest to fit", () => {
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
    it("aligns to user boundary", () => {
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
    it("drops orphan toolResult", () => {
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
    it("drops leading orphan toolResults when no user in kept slice", () => {
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
    it("keeps messages when orphanCount is 0", () => {
      const ctx: Context = {
        messages: [m("user", "a"), m("assistant", "b"), m("user", "final")],
      } as unknown as Context;
      const truncated = truncateContext(ctx, 1000);
      expect(truncated).toBe(ctx); // within limit, no truncation
    });
    it("preserves latest message always", () => {
      const ctx: Context = {
        messages: [m("user", "a".repeat(100)), m("user", "b".repeat(100)), m("user", "keep")],
      } as unknown as Context;
      const truncated = truncateContext(ctx, 1);
      expect((truncated.messages[truncated.messages.length - 1] as any).content).toBe("keep");
    });
    it("systemPrompt tokens counted", () => {
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
