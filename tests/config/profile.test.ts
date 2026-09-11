import { describe, expect, it } from "vitest";
import { profileNames, resolveProfileName } from "../../src/config/profile";
import type { RouterConfig } from "../../src/types";

describe("profile을 검증함", () => {
  describe("profileNames 동작을 검증함", () => {
    it("정렬된 이름을 반환함을 검증함", () => {
      const config: RouterConfig = {
        profiles: {
          zebra: { medium: { models: ["openai/a"] } },
          alpha: { medium: { models: ["openai/b"] } },
          middle: { medium: { models: ["openai/c"] } },
        },
      };
      expect(profileNames(config)).toEqual(["alpha", "middle", "zebra"]);
    });
    it("빈 입력을 처리함을 검증함", () => expect(profileNames({ profiles: {} })).toEqual([]));
    it("단일 항목을 처리함을 검증함", () =>
      expect(profileNames({ profiles: { only: {} as any } })).toEqual(["only"]));
  });
  describe("resolveProfileName 동작을 검증함", () => {
    const config: RouterConfig = {
      profiles: { balanced: { medium: { models: ["openai/a"] } } },
    };
    it("요청한 이름이 있으면 반환함을 검증함", () =>
      expect(resolveProfileName(config, "balanced")).toBe("balanced"));
    it("요청한 이름이 없으면 undefined 반환함을 검증함", () =>
      expect(resolveProfileName(config, "missing")).toBeUndefined());
    it("undefined 입력은 undefined 반환함을 검증함", () =>
      expect(resolveProfileName(config, undefined)).toBeUndefined());
    it("빈 문자열은 undefined 반환함을 검증함", () =>
      expect(resolveProfileName(config, "")).toBeUndefined());
    it("profile은 있으나 요청이 다르면 undefined 반환함을 검증함", () =>
      expect(resolveProfileName(config, "other")).toBeUndefined());
  });
});
