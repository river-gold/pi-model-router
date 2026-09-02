import { describe, expect, it } from "vitest";
import {
  buildUserPosMap,
  collectUserIndices,
  findFinalTextBetween,
  getHistoryPairsText,
  getNextUserIdx,
  isAssistantOrToolResult,
  resolveHistoryUserIndices,
} from "../../src/context/history";
import type { Context, Message } from "@earendil-works/pi-ai";

const msg = (role: string, content: string): Message => ({ role, content }) as unknown as Message;
const toolResult = (content: string): Message =>
  ({
    role: "toolResult",
    content,
    toolCallId: "1",
    toolName: "t",
    isError: false,
  }) as unknown as Message;

describe("history", () => {
  describe("collectUserIndices", () => {
    it("empty", () => expect(collectUserIndices([])).toEqual([]));
    it("collects", () =>
      expect(
        collectUserIndices([msg("user", "a"), msg("assistant", "b"), msg("user", "c")]),
      ).toEqual([0, 2]));
    it("no user", () =>
      expect(collectUserIndices([msg("assistant", "a"), toolResult("t")])).toEqual([]));
  });

  describe("resolveHistoryUserIndices", () => {
    it("empty", () => expect(resolveHistoryUserIndices([], 2)).toEqual([]));
    it("single user -> empty (excludes last)", () =>
      expect(resolveHistoryUserIndices([0], 1)).toEqual([]));
    it("pairCount 1", () => expect(resolveHistoryUserIndices([0, 1, 2], 1)).toEqual([1]));
    it("pairCount 2", () => expect(resolveHistoryUserIndices([0, 1, 2], 2)).toEqual([0, 1]));
    it("pairCount larger than available", () =>
      expect(resolveHistoryUserIndices([0, 1, 2], 10)).toEqual([0, 1]));
    it("pairCount exact", () => expect(resolveHistoryUserIndices([0, 1, 2, 3], 2)).toEqual([1, 2]));
  });

  describe("isAssistantOrToolResult", () => {
    it("assistant true", () => expect(isAssistantOrToolResult("assistant")).toBe(true));
    it("toolResult true", () => expect(isAssistantOrToolResult("toolResult")).toBe(true));
    it("user false", () => expect(isAssistantOrToolResult("user")).toBe(false));
    it("system false", () => expect(isAssistantOrToolResult("system")).toBe(false));
    it("toolCall false", () => expect(isAssistantOrToolResult("toolCall")).toBe(false));
  });

  describe("getNextUserIdx", () => {
    it("pos not last -> next user", () => expect(getNextUserIdx([0, 5, 10], 0, 20)).toBe(5));
    it("pos middle -> next", () => expect(getNextUserIdx([0, 5, 10], 1, 20)).toBe(10));
    it("pos last -> messagesLength", () => expect(getNextUserIdx([0, 5, 10], 2, 20)).toBe(20));
    it("pos last with different length", () => expect(getNextUserIdx([0], 0, 5)).toBe(5));
  });

  describe("buildUserPosMap", () => {
    it("empty", () => expect(buildUserPosMap([]).size).toBe(0));
    it("maps", () => {
      const m = buildUserPosMap([5, 10, 15]);
      expect(m.get(5)).toBe(0);
      expect(m.get(10)).toBe(1);
      expect(m.get(15)).toBe(2);
    });
  });

  describe("findFinalTextBetween", () => {
    it("finds assistant", () => {
      const messages = [msg("user", "u"), msg("assistant", "a"), msg("user", "next")];
      expect(findFinalTextBetween(messages, 0, 2)).toBe("a");
    });
    it("prefers last assistant/toolResult", () => {
      const messages = [
        msg("user", "u"),
        msg("assistant", "a1"),
        toolResult("t1"),
        msg("user", "next"),
      ];
      expect(findFinalTextBetween(messages, 0, 3)).toBe("t1");
    });
    it("skips empty", () => {
      const messages = [
        msg("user", "u"),
        msg("assistant", "   "),
        msg("assistant", "a"),
        msg("user", "n"),
      ];
      expect(findFinalTextBetween(messages, 0, 3)).toBe("a");
    });
    it("no assistant/toolResult -> empty", () => {
      const messages = [msg("user", "u"), msg("user", "next2")];
      expect(findFinalTextBetween(messages, 0, 1)).toBe("");
    });
    it("only user between -> empty", () => {
      expect(findFinalTextBetween([msg("user", "u"), msg("user", "n")], 0, 1)).toBe("");
    });
    it("ignores assistant with empty text", () => {
      const messages = [msg("user", "u"), msg("assistant", ""), msg("user", "n")];
      expect(findFinalTextBetween(messages, 0, 2)).toBe("");
    });
    it("finds toolResult", () => {
      const messages = [msg("user", "u"), toolResult("out"), msg("user", "n")];
      expect(findFinalTextBetween(messages, 0, 2)).toBe("out");
    });
    it("skips non-assistant/toolResult", () => {
      const messages = [
        msg("user", "u"),
        msg("system", "sys") as unknown as Message,
        msg("assistant", "a"),
        msg("user", "n"),
      ];
      expect(findFinalTextBetween(messages, 0, 3)).toBe("a");
    });
    it("all non-assistant -> empty", () => {
      const messages = [
        msg("user", "u"),
        msg("system", "sys") as unknown as Message,
        msg("user", "other") as unknown as Message,
        msg("user", "n"),
      ];
      expect(findFinalTextBetween(messages, 0, 3)).toBe("");
    });
  });

  describe("getHistoryPairsText", () => {
    it("pairCount 0 -> empty", () =>
      expect(getHistoryPairsText({ messages: [msg("user", "hi")] } as unknown as Context, 0)).toBe(
        "",
      ));
    it("pairCount negative -> empty", () =>
      expect(getHistoryPairsText({ messages: [msg("user", "hi")] } as unknown as Context, -1)).toBe(
        "",
      ));
    it("no history (single user) -> empty", () =>
      expect(
        getHistoryPairsText({ messages: [msg("user", "hello")] } as unknown as Context, 1),
      ).toBe(""));
    it("no user at all -> empty", () =>
      expect(
        getHistoryPairsText({ messages: [msg("assistant", "a")] } as unknown as Context, 1),
      ).toBe(""));
    it("user+assistant pair", () => {
      const ctx = {
        messages: [msg("user", "u1"), msg("assistant", "a1"), msg("user", "current")],
      } as unknown as Context;
      expect(getHistoryPairsText(ctx, 1)).toBe("u1\na1");
    });
    it("pair without finalText -> only user", () => {
      const ctx = {
        messages: [msg("user", "u1"), msg("user", "current")],
      } as unknown as Context;
      expect(getHistoryPairsText(ctx, 1)).toBe("u1");
    });
    it("skips empty userText", () => {
      const ctx = {
        messages: [msg("user", "   "), msg("assistant", "a1"), msg("user", "current")],
      } as unknown as Context;
      expect(getHistoryPairsText(ctx, 1)).toBe("");
    });
    it("skips empty userText but keeps next", () => {
      const ctx = {
        messages: [
          msg("user", "   "),
          msg("assistant", "a0"),
          msg("user", "u1"),
          msg("assistant", "a1"),
          msg("user", "current"),
        ],
      } as unknown as Context;
      expect(getHistoryPairsText(ctx, 2)).toBe("u1\na1");
    });
    it("multiple pairs joined", () => {
      const ctx = {
        messages: [
          msg("user", "u1"),
          msg("assistant", "a1"),
          msg("user", "u2"),
          msg("assistant", "a2"),
          msg("user", "current"),
        ],
      } as unknown as Context;
      expect(getHistoryPairsText(ctx, 2)).toBe("u1\na1\n---\nu2\na2");
    });
    it("picks toolResult as final", () => {
      const ctx = {
        messages: [msg("user", "u1"), toolResult("out"), msg("user", "current")],
      } as unknown as Context;
      expect(getHistoryPairsText(ctx, 1)).toBe("u1\nout");
    });
    it("pairCount larger than history", () => {
      const ctx = {
        messages: [msg("user", "u1"), msg("assistant", "a1"), msg("user", "current")],
      } as unknown as Context;
      expect(getHistoryPairsText(ctx, 10)).toBe("u1\na1");
    });
    it("history with only user before current, no assistant", () => {
      const ctx = {
        messages: [msg("user", "u1"), msg("user", "u2"), msg("user", "current")],
      } as unknown as Context;
      expect(getHistoryPairsText(ctx, 2)).toBe("u1\n---\nu2");
    });
  });
});
