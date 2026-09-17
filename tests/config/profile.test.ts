import { describe, expect, it } from "vitest";
import { routerNames, resolveRouterName } from "../../src/config/router";
import type { RouterConfig } from "../../src/types";

describe("router을 검증함", () => {
  describe("routerNames 동작을 검증함", () => {
    it("정렬된 이름을 반환함을 검증함", () => {
      const config: RouterConfig = {
        routers: {
          zebra: { medium: { models: ["openai/a"] } },
          alpha: { medium: { models: ["openai/b"] } },
          middle: { medium: { models: ["openai/c"] } },
        },
      };
      expect(routerNames(config)).toEqual(["alpha", "middle", "zebra"]);
    });
    it("빈 입력을 처리함을 검증함", () => expect(routerNames({ routers: {} })).toEqual([]));
    it("단일 항목을 처리함을 검증함", () =>
      expect(routerNames({ routers: { only: {} } })).toEqual(["only"]));
  });
  describe("resolveRouterName 동작을 검증함", () => {
    const config: RouterConfig = {
      routers: { balanced: { medium: { models: ["openai/a"] } } },
    };
    it("요청한 이름이 있으면 반환함을 검증함", () =>
      expect(resolveRouterName(config, "balanced")).toBe("balanced"));
    it("요청한 이름이 없으면 undefined 반환함을 검증함", () =>
      expect(resolveRouterName(config, "missing")).toBeUndefined());
    it("undefined 입력은 undefined 반환함을 검증함", () =>
      expect(resolveRouterName(config, undefined)).toBeUndefined());
    it("빈 문자열은 undefined 반환함을 검증함", () =>
      expect(resolveRouterName(config, "")).toBeUndefined());
    it("router은 있으나 요청이 다르면 undefined 반환함을 검증함", () =>
      expect(resolveRouterName(config, "other")).toBeUndefined());
  });
});
