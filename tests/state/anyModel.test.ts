import { describe, expect, it } from "vitest";
import { getAnyModel } from "../../src/state/anyModel";

describe("state/anyModel", () => {
  it("returns from list", () => {
    const registry = {
      list: () => [
        { provider: "openai", id: "gpt-4o" },
        { provider: "x", id: "y" },
      ],
    } as any;
    expect(getAnyModel(registry)).toEqual({ provider: "openai", id: "gpt-4o" });
  });

  it("returns from models when list empty", () => {
    const registry = {
      list: () => [],
      models: [{ provider: "a", id: "b" }],
    } as any;
    expect(getAnyModel(registry)).toEqual({ provider: "a", id: "b" });
  });

  it("returns from models when list undefined", () => {
    const registry = {
      models: [{ provider: "a", id: "b" }],
    } as any;
    expect(getAnyModel(registry)).toEqual({ provider: "a", id: "b" });
  });

  it("returns undefined when both empty", () => {
    expect(getAnyModel({ list: () => [], models: [] } as any)).toBeUndefined();
    expect(getAnyModel({} as any)).toBeUndefined();
    expect(getAnyModel({ list: () => undefined as any } as any)).toBeUndefined();
  });

  it("handles list throw", () => {
    const registry = {
      list: () => {
        throw new Error("fail");
      },
      models: [{ provider: "a", id: "b" }],
    } as any;
    expect(getAnyModel(registry)).toEqual({ provider: "a", id: "b" });
  });

  it("handles models throw", () => {
    const registry = {
      list: () => {
        throw new Error("fail");
      },
      get models() {
        throw new Error("fail2");
      },
    } as any;
    expect(getAnyModel(registry)).toBeUndefined();
  });

  it("handles list returning undefined", () => {
    const registry = {
      list: () => undefined as any,
      models: [{ provider: "a", id: "b" }],
    } as any;
    expect(getAnyModel(registry)).toEqual({ provider: "a", id: "b" });
  });

  it("prefers list over models", () => {
    const registry = {
      list: () => [{ provider: "list", id: "1" }],
      models: [{ provider: "models", id: "2" }],
    } as any;
    expect(getAnyModel(registry)).toEqual({ provider: "list", id: "1" });
  });
});
