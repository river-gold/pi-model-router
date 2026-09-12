import { describe, it, expect, vi } from "vitest";
import { modelWithAuthBaseUrl, streamDelegated } from "../src/stream";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { makeFakeModel, makeFakeProvider, makeFakeRegistry } from "./helpers";

describe("stream.ts 스트림은", () => {
  it("다르면 auth baseUrl을 적용한다", () => {
    const model = { ...makeFakeModel({ provider: "x", id: "m" }), baseUrl: "https://a" };
    const next = modelWithAuthBaseUrl(model, { baseUrl: "https://b" });
    expect(next.baseUrl).toBe("https://b");
    expect(model.baseUrl).toBe("https://a");
  });

  it("auth baseUrl이 없으면 model을 유지한다", () => {
    const model = { ...makeFakeModel({ provider: "x", id: "m" }), baseUrl: "https://a" };
    expect(modelWithAuthBaseUrl(model, {})).toBe(model);
  });

  it("registry에 stream provider가 없으면 throw한다", () => {
    const registry: ExtensionContext["modelRegistry"] = makeFakeRegistry({
      getProvider: () => undefined,
    });
    const model = makeFakeModel({ provider: "missing", id: "m" });
    expect(() => streamDelegated(registry, model, { messages: [] }, {})).toThrow(
      "No delegated stream provider registered for missing",
    );
  });

  it("registry provider의 streamSimple에 위임한다", () => {
    const streamSimple = vi.fn();
    streamSimple.mockReturnValue("stream");
    const registry: ExtensionContext["modelRegistry"] = makeFakeRegistry({
      getProvider: () => makeFakeProvider({ streamSimple }),
    });
    const model = makeFakeModel({ provider: "openai", id: "gpt" });
    const ctx = { messages: [] };
    const opts = { apiKey: "k" };
    expect(streamDelegated(registry, model, ctx, opts)).toBe("stream");
    expect(streamSimple).toHaveBeenCalledWith(model, ctx, opts);
  });
});
