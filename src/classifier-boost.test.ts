/* oxlint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runClassifierWithFallbacksDetailed } from "./classifier";
import type { Context } from "@earendil-works/pi-ai";

const streamSimple = vi.fn();

const makeRegistry = (over: any = {}) =>
  ({
    find: vi.fn((provider: string, modelId: string) => {
      if (over.find) return over.find(provider, modelId);
      if (provider === "openai" && modelId === "gpt")
        return { provider, id: modelId, reasoning: true } as any;
      if (provider === "openai" && modelId === "bad") return undefined;
      return { provider, id: modelId } as any;
    }),
    getApiKeyAndHeaders: vi.fn(async (model: any) => {
      if (over.getApiKeyAndHeaders) return over.getApiKeyAndHeaders(model);
      return { ok: true, apiKey: "k", headers: {} };
    }),
    getProvider: () => ({ streamSimple }),
  }) as any;

const ctx: Context = { messages: [{ role: "user", content: "hello", timestamp: 1 }] };

describe("classifier boost", () => {
  beforeEach(() => vi.clearAllMocks());
  it("skips failedSet", async () => {
    const reg = makeRegistry();
    const failed = new Set(["openai/gpt"]);
    const res = await runClassifierWithFallbacksDetailed(
      [{ model: "openai/gpt" }],
      reg,
      ctx,
      0,
      undefined,
      undefined,
      failed,
    );
    expect(res.attempts[0].error).toContain("skipped");
    expect(res.result).toBeUndefined();
  });
  it("calls onAttempt and succeeds on second", async () => {
    const reg = makeRegistry();
    const s1 = (async function* () {
      yield { type: "text_delta", delta: "bad" };
    })();
    const s2 = (async function* () {
      yield { type: "text_delta", delta: "high" };
    })();
    streamSimple.mockReturnValueOnce(s1 as any).mockReturnValueOnce(s2 as any);
    const onAttempt = vi.fn();
    const res = await runClassifierWithFallbacksDetailed(
      [{ model: "openai/gpt" }, { model: "openai/gpt" }],
      reg,
      ctx,
      0,
      undefined,
      onAttempt,
      new Set(),
    );
    expect(onAttempt).toHaveBeenCalledTimes(2);
    expect(res.result?.tier).toBe("high");
    expect(res.attempts.length).toBe(2);
  });
  it("adds to failedSet on skipSession", async () => {
    const reg = makeRegistry({ find: () => undefined });
    const failed = new Set<string>();
    const res = await runClassifierWithFallbacksDetailed(
      [{ model: "openai/bad" }],
      reg,
      ctx,
      0,
      undefined,
      undefined,
      failed,
    );
    expect(failed.has("openai/bad")).toBe(true);
    expect(res.attempts[0].error).toContain("model not found");
  });
  it("does not add to failedSet on parse failure", async () => {
    const reg = makeRegistry();
    const s = (async function* () {
      yield { type: "text_delta", delta: "invalid" };
    })();
    streamSimple.mockReturnValue(s as any);
    const failed = new Set<string>();
    const res = await runClassifierWithFallbacksDetailed(
      [{ model: "openai/gpt" }],
      reg,
      ctx,
      0,
      undefined,
      undefined,
      failed,
    );
    expect(failed.size).toBe(0);
    expect(res.result).toBeUndefined();
  });
  it("handles auth failure via fallback detailed", async () => {
    const reg = makeRegistry({ getApiKeyAndHeaders: async () => ({ ok: false, error: "no" }) });
    const res = await runClassifierWithFallbacksDetailed([{ model: "openai/gpt" }], reg, ctx, 0);
    expect(res.result).toBeUndefined();
  });
  it("handles stream throw and aborted signal via fallback", async () => {
    const reg = makeRegistry();
    streamSimple.mockImplementation(() => {
      throw new Error("stream fail");
    });
    const res = await runClassifierWithFallbacksDetailed([{ model: "openai/gpt" }], reg, ctx, 0);
    expect(res.result).toBeUndefined();
    const controller = new AbortController();
    controller.abort();
    streamSimple.mockImplementation(() => {
      throw new Error("aborted");
    });
    const res2 = await runClassifierWithFallbacksDetailed(
      [{ model: "openai/gpt" }],
      reg,
      ctx,
      0,
      controller.signal,
    );
    expect(res2.result).toBeUndefined();
  });
  it("handles reasoning option via fallback", async () => {
    const reg = makeRegistry();
    const s = (async function* () {
      yield { type: "text_delta", delta: "low" };
    })();
    streamSimple.mockReturnValue(s as any);
    const res = await runClassifierWithFallbacksDetailed(
      [{ model: "openai/gpt", thinking: "high" as any }],
      reg,
      ctx,
      0,
    );
    expect(res.result?.tier).toBe("low");
    const opts = streamSimple.mock.calls.at(-1)?.[2] as any;
    expect(opts.reasoning).toBe("high");
  });
  it("handles historySize >0 and history text via fallback", async () => {
    const reg = makeRegistry();
    const s = (async function* () {
      yield { type: "text_delta", delta: "medium" };
    })();
    streamSimple.mockReturnValue(s as any);
    const histCtx: Context = {
      messages: [
        { role: "user", content: "u1", timestamp: 1 },
        { role: "assistant", content: "a1", timestamp: 2 } as any,
        { role: "user", content: "cur", timestamp: 3 },
      ],
    };
    const res = await runClassifierWithFallbacksDetailed(
      [{ model: "openai/gpt" }],
      reg,
      histCtx,
      1,
    );
    expect(res.result?.tier).toBe("medium");
    const calledCtx = streamSimple.mock.calls.at(-1)?.[1] as Context;
    expect(calledCtx.messages[0].content as string).toContain("u1");
  });
  it("handles historySize but no historyText via fallback", async () => {
    const reg = makeRegistry();
    const s = (async function* () {
      yield { type: "text_delta", delta: "low" };
    })();
    streamSimple.mockReturnValue(s as any);
    const singleCtx: Context = { messages: [{ role: "user", content: "cur", timestamp: 1 }] };
    const res = await runClassifierWithFallbacksDetailed(
      [{ model: "openai/gpt" }],
      reg,
      singleCtx,
      1,
    );
    expect(res.result?.tier).toBe("low");
  });
});
