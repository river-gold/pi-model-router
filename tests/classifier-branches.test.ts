/* oxlint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runClassifierWithFallbacksDetailed } from "../src/classifier";
import type { Context } from "@earendil-works/pi-ai";

const streamSimple = vi.fn();

const makeRegistry = (over: Record<string, unknown> = {}) =>
  ({
    find: vi.fn((provider: string, modelId: string) => {
      const fn = over.find as ((p: string, m: string) => unknown) | undefined;
      if (fn) return fn(provider, modelId);
      if (provider === "openai" && modelId === "gpt")
        return { provider, id: modelId, reasoning: true } as unknown as never;
      return { provider, id: modelId } as unknown as never;
    }),
    getApiKeyAndHeaders: vi.fn(async () => {
      const fn = over.getApiKeyAndHeaders as
        | ((m: unknown) => Promise<unknown>)
        | undefined;
      if (fn) return fn({});
      return { ok: true, apiKey: "k", headers: {} };
    }),
    getProvider: () => ({ streamSimple }),
  }) as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext["modelRegistry"];

const ctx: Context = { messages: [{ role: "user", content: "hello", timestamp: 1 }] };

describe("classifier branches coverage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("covers auth ternary hasKey true branch (apiKey present but empty)", async () => {
    const reg = makeRegistry({
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "", headers: {} }),
    });
    const res = await runClassifierWithFallbacksDetailed(
      [{ model: "openai/gpt" }],
      reg,
      ctx,
      0,
    );
    expect(res.result).toBeUndefined();
    expect(res.attempts[0].error).toContain("auth failed");
    expect(res.attempts[0].error).toContain("hasKey=false");
  });

  it("covers stream event false branch (non text_delta)", async () => {
    const reg = makeRegistry();
    const s = (async function* () {
      yield { type: "other", data: "ignored" } as unknown as never;
      yield { type: "text_delta", delta: 123 } as unknown as never;
      yield { type: "text_delta" } as unknown as never;
      yield { type: "text_delta", delta: "low" } as unknown as never;
    })();
    streamSimple.mockReturnValue(s as unknown as ReturnType<typeof streamSimple>);
    const res = await runClassifierWithFallbacksDetailed(
      [{ model: "openai/gpt" }],
      reg,
      ctx,
      0,
    );
    // After skipping invalid events, the valid "low" should be parsed
    expect(res.result?.tier).toBe("low");
  });

  it("covers stream event false branch with only invalid events", async () => {
    const reg = makeRegistry();
    const s = (async function* () {
      yield { type: "tool_call", delta: "x" } as unknown as never;
    })();
    streamSimple.mockReturnValue(s as unknown as ReturnType<typeof streamSimple>);
    const res = await runClassifierWithFallbacksDetailed(
      [{ model: "openai/gpt" }],
      reg,
      ctx,
      0,
    );
    expect(res.result).toBeUndefined();
  });

  it("covers catch non-Error branch (throw string)", async () => {
    const reg = makeRegistry();
    streamSimple.mockImplementation(() => {
      throw "string thrown";
    });
    const res = await runClassifierWithFallbacksDetailed(
      [{ model: "openai/gpt" }],
      reg,
      ctx,
      0,
    );
    expect(res.result).toBeUndefined();
    expect(res.attempts[0].error).toBe("string thrown");
  });

  it("covers catch non-Error branch (throw number)", async () => {
    const reg = makeRegistry();
    streamSimple.mockImplementation(() => {
      throw 42;
    });
    const res = await runClassifierWithFallbacksDetailed(
      [{ model: "openai/gpt" }],
      reg,
      ctx,
      0,
    );
    expect(res.result).toBeUndefined();
    expect(res.attempts[0].error).toBe("42");
  });
});
