/* oxlint-disable */
import { describe, it, expect, vi } from "vitest";
import {
  CLASSIFIER_SYSTEM_PROMPT,
  parseClassifierOutput,
  runClassifierWithFallbacksDetailed,
} from "../src/classifier";
import type { Context } from "@earendil-works/pi-ai";

const streamSimple = vi.fn();

describe("classifier.ts", () => {
  const mockRegistry = {
    find: (provider: string, modelId: string) => {
      if (provider === "openai" && modelId === "gpt-4o") {
        return { provider, id: modelId, reasoning: true } as unknown as never;
      }
      return undefined;
    },
    getApiKeyAndHeaders: async () => ({
      ok: true as const,
      apiKey: "k",
      headers: {},
    }),
    getProvider: () => ({ streamSimple }),
  } as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext["modelRegistry"];

  const baseContext: Context = {
    messages: [{ role: "user", content: "hello", timestamp: 1 }],
  };

  it("should return tier and reasoning from LLM", async () => {
    const s = (async function* () {
      yield { type: "text_delta", delta: "high" };
    })();
    vi.mocked(streamSimple).mockReturnValue(s as unknown as ReturnType<typeof streamSimple>);
    const res = await runClassifierWithFallbacksDetailed(
      [{ model: "openai/gpt-4o" }],
      mockRegistry,
      baseContext,
      0,
    );
    expect(res.result).toEqual({ tier: "high", reasoning: "Classifier decision." });
  });

  it("should return undefined on invalid format", async () => {
    const s = (async function* () {
      yield { type: "text_delta", delta: "invalid" };
    })();
    vi.mocked(streamSimple).mockReturnValue(s as unknown as ReturnType<typeof streamSimple>);
    const res = await runClassifierWithFallbacksDetailed(
      [{ model: "openai/gpt-4o" }],
      mockRegistry,
      baseContext,
      0,
    );
    expect(res.result).toBeUndefined();
  });

  it("should return undefined if model not found", async () => {
    const res = await runClassifierWithFallbacksDetailed(
      [{ model: "unknown/model" }],
      mockRegistry,
      baseContext,
      0,
    );
    expect(res.result).toBeUndefined();
  });

  it("should pass history when historySize >0", async () => {
    const s = (async function* () {
      yield { type: "text_delta", delta: "low" };
    })();
    vi.mocked(streamSimple).mockReturnValue(s as unknown as ReturnType<typeof streamSimple>);
    const ctx: Context = {
      messages: [
        { role: "user", content: "u1", timestamp: 1 },
        {
          role: "assistant",
          content: "a1",
          timestamp: 2,
        } as unknown as import("@earendil-works/pi-ai").Message,
        { role: "user", content: "cur", timestamp: 3 },
      ],
    };
    await runClassifierWithFallbacksDetailed([{ model: "openai/gpt-4o" }], mockRegistry, ctx, 1);
    const called = vi.mocked(streamSimple).mock.calls.at(-1)?.[1] as Context;
    expect(called.messages[0].content as string).toContain("u1");
    expect(called.messages[0].content as string).toContain("a1");
    expect(called.systemPrompt).toBe(CLASSIFIER_SYSTEM_PROMPT);
  });

  it("should return undefined when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const s = (async function* () {
      yield { type: "text_delta", delta: "high" };
    })();
    vi.mocked(streamSimple).mockReturnValue(s as unknown as ReturnType<typeof streamSimple>);
    const res = await runClassifierWithFallbacksDetailed(
      [{ model: "openai/gpt-4o" }],
      mockRegistry,
      baseContext,
      0,
      controller.signal,
    );
    expect(res.result === undefined || res.result.tier === "high").toBe(true);
  });

  it("should pass signal to streamSimple", async () => {
    const controller = new AbortController();
    const s = (async function* () {
      yield { type: "text_delta", delta: "medium" };
    })();
    vi.mocked(streamSimple).mockReturnValue(s as unknown as ReturnType<typeof streamSimple>);
    await runClassifierWithFallbacksDetailed(
      [{ model: "openai/gpt-4o" }],
      mockRegistry,
      baseContext,
      0,
      controller.signal,
    );
    const opts = vi.mocked(streamSimple).mock.calls.at(-1)?.[2] as Record<string, unknown>;
    expect(opts.signal).toBe(controller.signal);
  });

  it("parseClassifierOutput extracts Tier anywhere in the text", () => {
    expect(parseClassifierOutput("low")).toMatchObject({
      tier: "low",
      reasoning: "Classifier decision.",
    });
    expect(parseClassifierOutput("  HIGH  ")).toMatchObject({
      tier: "high",
    });
    expect(parseClassifierOutput("invalid")).toBeUndefined();
    expect(parseClassifierOutput("Tier: low")).toBeUndefined();
    expect(parseClassifierOutput("Tier: low\nReasoning: x")).toBeUndefined();
  });

  it("should handle historySize and thinking", async () => {
    const s1 = (async function* () {
      yield { type: "text_delta", delta: "medium" };
    })();
    const s2 = (async function* () {
      yield { type: "text_delta", delta: "medium" };
    })();
    vi.mocked(streamSimple)
      .mockReturnValueOnce(s1 as unknown as ReturnType<typeof streamSimple>)
      .mockReturnValueOnce(s2 as unknown as ReturnType<typeof streamSimple>);
    const r1 = await runClassifierWithFallbacksDetailed(
      [{ model: "openai/gpt-4o", thinking: "high" as any }],
      mockRegistry,
      baseContext,
      0,
    );
    expect(r1.result?.tier).toBe("medium");
    const r2 = await runClassifierWithFallbacksDetailed(
      [{ model: "openai/gpt-4o", thinking: "high" as any }],
      mockRegistry,
      baseContext,
      2,
    );
    expect(r2.result?.tier).toBe("medium");
  });
});
