/* oxlint-disable */
import { describe, it, expect, vi } from "vitest";
import { modelWithAuthBaseUrl, streamDelegated } from "../src/stream";
import type { Api, Model } from "@earendil-works/pi-ai";

describe("stream.ts 스트림은", () => {
  it("다르면 auth baseUrl을 적용한다", () => {
    const model = {
      provider: "x",
      id: "m",
      baseUrl: "https://a",
    } as unknown as Model<Api> & { baseUrl: string };
    const next = modelWithAuthBaseUrl(model, { baseUrl: "https://b" });
    expect(next.baseUrl).toBe("https://b");
    expect(model.baseUrl).toBe("https://a");
  });

  it("auth baseUrl이 없으면 model을 유지한다", () => {
    const model = {
      provider: "x",
      id: "m",
      baseUrl: "https://a",
    } as unknown as Model<Api> & { baseUrl: string };
    expect(modelWithAuthBaseUrl(model, {})).toBe(model);
  });

  it("registry에 stream provider가 없으면 throw한다", () => {
    const registry = {
      getProvider: () => undefined,
    } as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext["modelRegistry"];
    const model = { provider: "missing", id: "m" } as unknown as Model<Api>;
    expect(() => streamDelegated(registry, model, { messages: [] }, {})).toThrow(
      "No delegated stream provider registered for missing",
    );
  });

  it("registry provider의 streamSimple에 위임한다", () => {
    const streamSimple = vi.fn().mockReturnValue("stream");
    const registry = {
      getProvider: () => ({ streamSimple }),
    } as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext["modelRegistry"];
    const model = { provider: "openai", id: "gpt" } as unknown as Model<Api>;
    const ctx = { messages: [] };
    const opts = { apiKey: "k" };
    expect(streamDelegated(registry, model, ctx, opts)).toBe("stream");
    expect(streamSimple).toHaveBeenCalledWith(model, ctx, opts);
  });
});
