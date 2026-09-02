import { describe, expect, it } from "vitest";
import { findLastUserIndex, getLastUserText } from "../../src/context/lastUser";
import type { Context, Message } from "@earendil-works/pi-ai";

describe("lastUser", () => {
  describe("findLastUserIndex", () => {
    it("empty", () => expect(findLastUserIndex([])).toBe(-1));
    it("no user", () =>
      expect(
        findLastUserIndex([
          { role: "assistant", content: "a" } as unknown as Message,
          { role: "toolResult", content: "t" } as unknown as Message,
        ]),
      ).toBe(-1));
    it("single user", () =>
      expect(findLastUserIndex([{ role: "user", content: "hi" } as unknown as Message])).toBe(0));
    it("last is user", () =>
      expect(
        findLastUserIndex([
          { role: "user", content: "u1" } as unknown as Message,
          { role: "assistant", content: "a" } as unknown as Message,
          { role: "user", content: "u2" } as unknown as Message,
        ]),
      ).toBe(2));
    it("last is not user", () =>
      expect(
        findLastUserIndex([
          { role: "user", content: "u1" } as unknown as Message,
          { role: "assistant", content: "a" } as unknown as Message,
        ]),
      ).toBe(0));
    it("multiple users", () =>
      expect(
        findLastUserIndex([
          { role: "user", content: "u1" } as unknown as Message,
          { role: "user", content: "u2" } as unknown as Message,
          { role: "assistant", content: "a" } as unknown as Message,
        ]),
      ).toBe(1));
  });

  describe("getLastUserText", () => {
    it("empty -> empty", () =>
      expect(getLastUserText({ messages: [] } as unknown as Context)).toBe(""));
    it("no user -> empty", () =>
      expect(
        getLastUserText({
          messages: [{ role: "assistant", content: "a" } as unknown as Message],
        } as unknown as Context),
      ).toBe(""));
    it("last user trimmed", () =>
      expect(
        getLastUserText({
          messages: [{ role: "user", content: "  hello  " } as unknown as Message],
        } as unknown as Context),
      ).toBe("hello"));
    it("last user with array content", () =>
      expect(
        getLastUserText({
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "  t  " } as any],
            } as unknown as Message,
          ],
        } as unknown as Context),
      ).toBe("t"));
    it("last user empty after trim -> empty string", () =>
      expect(
        getLastUserText({
          messages: [{ role: "user", content: "   " } as unknown as Message],
        } as unknown as Context),
      ).toBe(""));
    it("last user not last message", () =>
      expect(
        getLastUserText({
          messages: [
            { role: "user", content: "u1" } as unknown as Message,
            { role: "assistant", content: "a" } as unknown as Message,
            { role: "user", content: "u2" } as unknown as Message,
            { role: "assistant", content: "a2" } as unknown as Message,
          ],
        } as unknown as Context),
      ).toBe("u2"));
  });
});
