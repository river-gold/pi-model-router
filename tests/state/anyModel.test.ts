import { describe, expect, it } from "vitest";
import { getAnyModel } from "../../src/state/anyModel";

describe("state/anyModel 모듈", () => {
  it("list에서 반환한다", () => {
    const registry = {
      list: () => [
        { provider: "openai", id: "gpt-4o" },
        { provider: "x", id: "y" },
      ],
    } as any;
    expect(getAnyModel(registry)).toEqual({ provider: "openai", id: "gpt-4o" });
  });

  it("list가 비어 있으면 models에서 반환한다", () => {
    const registry = {
      list: () => [],
      models: [{ provider: "a", id: "b" }],
    } as any;
    expect(getAnyModel(registry)).toEqual({ provider: "a", id: "b" });
  });

  it("list가 undefined이면 models에서 반환한다", () => {
    const registry = {
      models: [{ provider: "a", id: "b" }],
    } as any;
    expect(getAnyModel(registry)).toEqual({ provider: "a", id: "b" });
  });

  it("둘 다 비어 있으면 undefined를 반환한다", () => {
    expect(getAnyModel({ list: () => [], models: [] } as any)).toBeUndefined();
    expect(getAnyModel({} as any)).toBeUndefined();
    expect(getAnyModel({ list: () => undefined as any } as any)).toBeUndefined();
  });

  it("list 예외를 처리한다", () => {
    const registry = {
      list: () => {
        throw new Error("fail");
      },
      models: [{ provider: "a", id: "b" }],
    } as any;
    expect(getAnyModel(registry)).toEqual({ provider: "a", id: "b" });
  });

  it("models 예외를 처리한다", () => {
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

  it("list가 undefined를 반환해도 처리한다", () => {
    const registry = {
      list: () => undefined as any,
      models: [{ provider: "a", id: "b" }],
    } as any;
    expect(getAnyModel(registry)).toEqual({ provider: "a", id: "b" });
  });

  it("models보다 list를 우선한다", () => {
    const registry = {
      list: () => [{ provider: "list", id: "1" }],
      models: [{ provider: "models", id: "2" }],
    } as any;
    expect(getAnyModel(registry)).toEqual({ provider: "list", id: "1" });
  });
});
