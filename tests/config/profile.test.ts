import { describe, expect, it } from "vitest";
import { profileNames, resolveProfileName } from "../../src/config/profile";
import type { RouterConfig } from "../../src/types";

describe("profile", () => {
  describe("profileNames", () => {
    it("sorted", () => {
      const config: RouterConfig = {
        profiles: {
          zebra: { medium: { models: ["openai/a"] } },
          alpha: { medium: { models: ["openai/b"] } },
          middle: { medium: { models: ["openai/c"] } },
        },
      };
      expect(profileNames(config)).toEqual(["alpha", "middle", "zebra"]);
    });
    it("empty", () => expect(profileNames({ profiles: {} })).toEqual([]));
    it("single", () => expect(profileNames({ profiles: { only: {} as any } })).toEqual(["only"]));
  });
  describe("resolveProfileName", () => {
    const config: RouterConfig = {
      profiles: { balanced: { medium: { models: ["openai/a"] } } },
    };
    it("requested exists -> returns", () => expect(resolveProfileName(config, "balanced")).toBe("balanced"));
    it("requested not exists -> undefined", () => expect(resolveProfileName(config, "missing")).toBeUndefined());
    it("undefined -> undefined", () => expect(resolveProfileName(config, undefined)).toBeUndefined());
    it("empty string -> undefined", () => expect(resolveProfileName(config, "")).toBeUndefined());
    it("profile exists but requested different -> undefined", () =>
      expect(resolveProfileName(config, "other")).toBeUndefined());
  });
});
