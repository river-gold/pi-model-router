/* oxlint-disable */
import { describe, it, expect, vi } from "vitest";
import { modelWithAuthBaseUrl, streamDelegated } from "../src/stream";
import type { Api, Model } from "@earendil-works/pi-ai";

describe("stream.ts", () => {
  it("applies auth baseUrl when different", () => {
    const model = {
      provider: "x",
      id: "m",
      baseUrl: "https://a",
    } as unknown as Model<Api> & { baseUrl: string };
    const next = modelWithAuthBaseUrl(model, { baseUrl: "https://b" });
    expect(next.baseUrl).toBe("https://b");
    expect(model.baseUrl).toBe("https://a");
  });

  it("keeps model when auth baseUrl is absent", () => {
    const model = {
      provider: "x",
      id: "m",
      baseUrl: "https://a",
    } as unknown as Model<Api> & { baseUrl: string };
    expect(modelWithAuthBaseUrl(model, {})).toBe(model);
  });

  it("throws when registry has no stream provider", () => {
    const registry = {
      getProvider: () => undefined,
    } as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext["modelRegistry"];
    const model = { provider: "missing", id: "m" } as unknown as Model<Api>;
    expect(() => streamDelegated(registry, model, { messages: [] }, {})).toThrow(
      "No delegated stream provider registered for missing",
    );
  });

  it("delegates to registry provider streamSimple", () => {
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
