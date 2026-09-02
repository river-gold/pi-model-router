import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseClassifierOutput, runClassifierWithFallbacksDetailed } from "../src/classifier";
import type { Context } from "@earendil-works/pi-ai";
const streamSimple = vi.fn();
const makeRegistry = (over: Record<string, unknown> = {}) =>
  ({
    find: vi.fn((p: string, m: string) => {
      const fn = over.find as ((a: string, b: string) => unknown) | undefined;
      if (fn) return fn(p, m);
      if (p === "openai" && m === "plain") return { provider: p, id: m, baseUrl: "" } as never;
      return { provider: p, id: m, reasoning: true, baseUrl: "" } as never;
    }),
    getApiKeyAndHeaders: vi.fn(async () => {
      const fn = over.getApiKeyAndHeaders as ((m: unknown) => Promise<unknown>) | undefined;
      if (fn) return fn({});
      return { ok: true, apiKey: "k", headers: {} };
    }),
    getProvider: () => ({ streamSimple }),
  }) as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext["modelRegistry"];
const baseCtx: Context = { messages: [{ role: "user", content: "hello", timestamp: 1 }] };
describe("parseClassifierOutput", () => {
  it("given valid tier then returns tier", () => { expect(parseClassifierOutput("low")?.tier).toBe("low"); });
  it("given case and spaces then normalizes", () => { expect(parseClassifierOutput("  HIGH  ")?.tier).toBe("high"); });
  it("given empty then undefined", () => { expect(parseClassifierOutput("   ")).toBeUndefined(); });
  it("given invalid then undefined", () => { expect(parseClassifierOutput("invalid")).toBeUndefined(); });
});
describe("runClassifierWithFallbacksDetailed", () => {
  beforeEach(() => vi.clearAllMocks());
  it("given valid stream then returns tier", async () => {
    const reg = makeRegistry();
    streamSimple.mockReturnValue((async function* () { yield { type: "text_delta", delta: "high" }; })() as never);
    expect((await runClassifierWithFallbacksDetailed([{ model: "openai/gpt" }], reg, baseCtx, 0)).result?.tier).toBe("high");
  });
  it("given parse failure then retryable", async () => {
    const reg = makeRegistry();
    streamSimple.mockReturnValue((async function* () { yield { type: "text_delta", delta: "bad" }; })() as never);
    const failed = new Set<string>();
    const res = await runClassifierWithFallbacksDetailed([{ model: "openai/gpt" }], reg, baseCtx, 0, undefined, undefined, failed);
    expect(res.result).toBeUndefined(); expect(failed.size).toBe(0); expect(res.attempts[0].error).toContain("no tier parsed");
  });
  it("given model not found then skipped session", async () => {
    const reg = makeRegistry({ find: () => undefined }); const failed = new Set<string>();
    const res = await runClassifierWithFallbacksDetailed([{ model: "openai/missing" }], reg, baseCtx, 0, undefined, undefined, failed);
    expect(res.attempts[0].error).toContain("model not found"); expect(failed.has("openai/missing")).toBe(true);
  });
  it("given auth ok false then error", async () => {
    const reg = makeRegistry({ getApiKeyAndHeaders: async () => ({ ok: false }) });
    expect((await runClassifierWithFallbacksDetailed([{ model: "openai/gpt" }], reg, baseCtx, 0)).attempts[0].error).toContain("auth failed");
  });
  it("given empty apiKey then hasKey false", async () => {
    const reg = makeRegistry({ getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "", headers: {} }) });
    expect((await runClassifierWithFallbacksDetailed([{ model: "openai/gpt" }], reg, baseCtx, 0)).attempts[0].error).toContain("hasKey=false");
  });
  it("given fallback chain then second succeeds", async () => {
    const reg = makeRegistry();
    const s1 = (async function* () { yield { type: "text_delta", delta: "bad" }; })();
    const s2 = (async function* () { yield { type: "text_delta", delta: "low" }; })();
    streamSimple.mockReturnValueOnce(s1 as never).mockReturnValueOnce(s2 as never);
    expect((await runClassifierWithFallbacksDetailed([{ model: "openai/gpt" }, { model: "openai/gpt" }], reg, baseCtx, 0)).result?.tier).toBe("low");
  });
  it("given failedSet contains model then skipped", async () => {
    const reg = makeRegistry(); const failed = new Set(["openai/gpt"]);
    expect((await runClassifierWithFallbacksDetailed([{ model: "openai/gpt" }], reg, baseCtx, 0, undefined, undefined, failed)).attempts[0].error).toContain("skipped");
  });
  it("given aborted signal then aborted", async () => {
    const reg = makeRegistry(); streamSimple.mockImplementation(() => { throw new Error("boom"); });
    const c = new AbortController(); c.abort();
    expect((await runClassifierWithFallbacksDetailed([{ model: "openai/gpt" }], reg, baseCtx, 0, c.signal)).attempts[0].error).toBe("aborted");
  });
  it("given non-Error throw then string error", async () => {
    const reg = makeRegistry(); streamSimple.mockImplementation(() => { throw "string thrown"; });
    expect((await runClassifierWithFallbacksDetailed([{ model: "openai/gpt" }], reg, baseCtx, 0)).attempts[0].error).toBe("string thrown");
  });
  it("given mixed events then valid delta parsed", async () => {
    const reg = makeRegistry();
    const s = (async function* () { yield { type: "other" } as never; yield { type: "text_delta", delta: 123 } as never; yield { type: "text_delta", delta: "medium" } as never; })();
    streamSimple.mockReturnValue(s as never);
    expect((await runClassifierWithFallbacksDetailed([{ model: "openai/gpt" }], reg, baseCtx, 0)).result?.tier).toBe("medium");
  });
  it("given null event then ignored", async () => {
    const reg = makeRegistry();
    const s = (async function* () { yield null as never; yield { type: "text_delta", delta: "low" } as never; })();
    streamSimple.mockReturnValue(s as never);
    expect((await runClassifierWithFallbacksDetailed([{ model: "openai/gpt" }], reg, baseCtx, 0)).result?.tier).toBe("low");
  });
  it("given Error throw then message", async () => {
    const reg = makeRegistry(); streamSimple.mockImplementation(() => { throw new Error("stream fail"); });
    expect((await runClassifierWithFallbacksDetailed([{ model: "openai/gpt" }], reg, baseCtx, 0)).attempts[0].error).toBe("stream fail");
  });
  it("given reasoning off with reasoning model then succeeds", async () => {
    const reg = makeRegistry(); streamSimple.mockReturnValue((async function* () { yield { type: "text_delta", delta: "low" }; })() as never);
    expect((await runClassifierWithFallbacksDetailed([{ model: "openai/gpt", thinking: "off" as never }], reg, baseCtx, 0)).result?.tier).toBe("low");
  });
  it("given history then succeeds", async () => {
    const reg = makeRegistry(); streamSimple.mockReturnValue((async function* () { yield { type: "text_delta", delta: "low" }; })() as never);
    const histCtx: Context = { messages: [{ role: "user", content: "u1", timestamp: 1 }, { role: "assistant", content: "a1", timestamp: 2 } as never, { role: "user", content: "cur", timestamp: 3 }] };
    expect((await runClassifierWithFallbacksDetailed([{ model: "openai/gpt", thinking: "high" as never }], reg, histCtx, 1)).result?.tier).toBe("low");
    streamSimple.mockReturnValue((async function* () { yield { type: "text_delta", delta: "low" }; })() as never);
    const singleCtx: Context = { messages: [{ role: "user", content: "cur", timestamp: 1 }] };
    expect((await runClassifierWithFallbacksDetailed([{ model: "openai/plain", thinking: "off" as never }], reg, singleCtx, 1)).result?.tier).toBe("low");
  });
});
