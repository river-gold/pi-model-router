import { describe, expect, it } from "vitest";
import { resolveDelegatedReasoning } from "../../src/config/reasoning";
import type { Api, Model } from "@earendil-works/pi-ai";

describe("reasoning", () => {
  it("requested undefined -> undefined", () => {
    expect(resolveDelegatedReasoning({ reasoning: true } as unknown as Model<Api>, undefined)).toBeUndefined();
  });
  it("model without reasoning -> undefined", () => {
    expect(resolveDelegatedReasoning({ reasoning: false } as unknown as Model<Api>, "high")).toBeUndefined();
    expect(resolveDelegatedReasoning({} as unknown as Model<Api>, "high")).toBeUndefined();
    expect(resolveDelegatedReasoning({ reasoning: undefined } as unknown as Model<Api>, "high")).toBeUndefined();
  });
  it("requested off -> undefined even if model supports", () => {
    expect(resolveDelegatedReasoning({ reasoning: true } as unknown as Model<Api>, "off")).toBeUndefined();
  });
  it("requested high with reasoning true -> high", () => {
    expect(resolveDelegatedReasoning({ reasoning: true } as unknown as Model<Api>, "high")).toBe("high");
  });
  it("requested empty string -> undefined (falsy)", () => {
    expect(resolveDelegatedReasoning({ reasoning: true } as unknown as Model<Api>, "")).toBeUndefined();
  });
  it("requested with reasoning false -> undefined", () => {
    expect(resolveDelegatedReasoning({ reasoning: false } as unknown as Model<Api>, "off")).toBeUndefined();
  });
});
