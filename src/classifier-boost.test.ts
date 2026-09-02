/* oxlint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runClassifierWithFallbacksDetailed, runClassifier } from "./classifier";
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
  it("runClassifier handles auth failure", async () => {
    const reg = makeRegistry({ getApiKeyAndHeaders: async () => ({ ok: false, error: "no" }) });
    const r = await runClassifier("openai/gpt", reg, ctx);
    expect(r).toBeUndefined();
  });
  it("runClassifier handles stream throw and aborted signal", async () => {
    const reg = makeRegistry();
    streamSimple.mockImplementation(() => {
      throw new Error("stream fail");
    });
    const r = await runClassifier("openai/gpt", reg, ctx);
    expect(r).toBeUndefined();
    const controller = new AbortController();
    controller.abort();
    streamSimple.mockImplementation(() => {
      throw new Error("aborted");
    });
    const r2 = await runClassifier("openai/gpt", reg, ctx, 0, undefined, controller.signal);
    expect(r2).toBeUndefined();
  });
  it("runClassifier with reasoning option", async () => {
    const reg = makeRegistry();
    const s = (async function* () {
      yield { type: "text_delta", delta: "low" };
    })();
    streamSimple.mockReturnValue(s as any);
    const r = await runClassifier("openai/gpt", reg, ctx, 0, "high" as any);
    expect(r?.tier).toBe("low");
    const opts = streamSimple.mock.calls.at(-1)?.[2] as any;
    expect(opts.reasoning).toBe("high");
  });
  it("runClassifier with historySize >0 and history text", async () => {
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
    const r = await runClassifier("openai/gpt", reg, histCtx, 1);
    expect(r?.tier).toBe("medium");
    const calledCtx = streamSimple.mock.calls.at(-1)?.[1] as Context;
    expect(calledCtx.messages[0].content as string).toContain("u1");
  });
  it("runClassifier with historySize but no historyText", async () => {
    const reg = makeRegistry();
    const s = (async function* () {
      yield { type: "text_delta", delta: "low" };
    })();
    streamSimple.mockReturnValue(s as any);
    const singleCtx: Context = { messages: [{ role: "user", content: "cur", timestamp: 1 }] };
    const r = await runClassifier("openai/gpt", reg, singleCtx, 1);
    expect(r?.tier).toBe("low");
  });
});
