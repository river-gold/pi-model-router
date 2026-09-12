import { describe, expect, it } from "vitest";
import { getAnyModel } from "../../src/state/anyModel";
import { makeFakeRegistry } from "../helpers";

describe("state/anyModel 모듈", () => {
  it("list에서 반환한다", () => {
    const registry = Object.assign(makeFakeRegistry(), {
      list: () => [
        { provider: "openai", id: "gpt-4o" },
        { provider: "x", id: "y" },
      ],
    });
    expect(getAnyModel(registry)).toEqual({ provider: "openai", id: "gpt-4o" });
  });

  it("list가 비어 있으면 models에서 반환한다", () => {
    const registry = Object.assign(makeFakeRegistry(), {
      list: () => [],
      models: [{ provider: "a", id: "b" }],
    });
    expect(getAnyModel(registry)).toEqual({ provider: "a", id: "b" });
  });

  it("list가 undefined이면 models에서 반환한다", () => {
    const registry = Object.assign(makeFakeRegistry(), {
      list: undefined,
      models: [{ provider: "a", id: "b" }],
    });
    expect(getAnyModel(registry)).toEqual({ provider: "a", id: "b" });
  });

  it("둘 다 비어 있으면 undefined를 반환한다", () => {
    expect(
      getAnyModel(Object.assign(makeFakeRegistry(), { list: () => [], models: [] })),
    ).toBeUndefined();
    expect(getAnyModel(makeFakeRegistry())).toBeUndefined();
    expect(
      getAnyModel(Object.assign(makeFakeRegistry(), { list: () => undefined })),
    ).toBeUndefined();
  });

  it("list 예외를 처리한다", () => {
    const registry = Object.assign(makeFakeRegistry(), {
      list: () => {
        throw new Error("fail");
      },
      models: [{ provider: "a", id: "b" }],
    });
    expect(getAnyModel(registry)).toEqual({ provider: "a", id: "b" });
  });

  it("models 예외를 처리한다", () => {
    const registry = Object.assign(makeFakeRegistry(), {
      list: () => {
        throw new Error("fail");
      },
    });
    Object.defineProperty(registry, "models", {
      get() {
        throw new Error("fail2");
      },
      configurable: true,
    });
    expect(getAnyModel(registry)).toBeUndefined();
  });

  it("list가 undefined를 반환해도 처리한다", () => {
    const registry = Object.assign(makeFakeRegistry(), {
      list: () => undefined,
      models: [{ provider: "a", id: "b" }],
    });
    expect(getAnyModel(registry)).toEqual({ provider: "a", id: "b" });
  });

  it("models보다 list를 우선한다", () => {
    const registry = Object.assign(makeFakeRegistry(), {
      list: () => [{ provider: "list", id: "1" }],
      models: [{ provider: "models", id: "2" }],
    });
    expect(getAnyModel(registry)).toEqual({ provider: "list", id: "1" });
  });

  it("registry가 객체가 아니면 undefined를 반환한다", () => {
    const nullRegistry: any = null;
    const undefinedRegistry: any = undefined;
    expect(getAnyModel(nullRegistry)).toBeUndefined();
    expect(getAnyModel(undefinedRegistry)).toBeUndefined();
  });
});
