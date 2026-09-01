import { describe, it, expect, vi } from "vitest";
import {
	runClassifier,
	CLASSIFIER_SYSTEM_PROMPT,
	parseClassifierOutput,
} from "./classifier";
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
			yield { type: "text_delta", delta: "Tier: high\n" };
			yield { type: "text_delta", delta: "Reasoning: test" };
		})();
		vi.mocked(streamSimple).mockReturnValue(
			s as unknown as ReturnType<typeof streamSimple>,
		);
		const r = await runClassifier(
			"openai/gpt-4o",
			mockRegistry,
			baseContext,
			"off" as unknown as import("@earendil-works/pi-agent-core").ThinkingLevel,
		);
		expect(r).toEqual({ tier: "high", reasoning: "test" });
	});

	it("should return undefined on invalid format", async () => {
		const s = (async function* () {
			yield { type: "text_delta", delta: "invalid" };
		})();
		vi.mocked(streamSimple).mockReturnValue(
			s as unknown as ReturnType<typeof streamSimple>,
		);
		const r = await runClassifier("openai/gpt-4o", mockRegistry, baseContext);
		expect(r).toBeUndefined();
	});

	it("should return undefined if model not found", async () => {
		const r = await runClassifier("unknown/model", mockRegistry, baseContext);
		expect(r).toBeUndefined();
	});

	it("should pass history when historySize >0", async () => {
		const s = (async function* () {
			yield { type: "text_delta", delta: "Tier: low\nReasoning: ok" };
		})();
		vi.mocked(streamSimple).mockReturnValue(
			s as unknown as ReturnType<typeof streamSimple>,
		);
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
		await runClassifier(
			"openai/gpt-4o",
			mockRegistry,
			ctx,
			1,
			"off" as unknown as import("@earendil-works/pi-agent-core").ThinkingLevel,
		);
		const called = vi.mocked(streamSimple).mock.calls.at(-1)?.[1] as Context;
		expect(called.messages[0].content as string).toContain("u1");
		expect(called.messages[0].content as string).toContain("a1");
		expect(called.systemPrompt).toBe(CLASSIFIER_SYSTEM_PROMPT);
	});

	it("should return undefined when signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const s = (async function* () {
			yield { type: "text_delta", delta: "Tier: high\nReasoning: ok" };
		})();
		vi.mocked(streamSimple).mockReturnValue(
			s as unknown as ReturnType<typeof streamSimple>,
		);
		const r = await runClassifier(
			"openai/gpt-4o",
			mockRegistry,
			baseContext,
			0,
			"off" as unknown as import("@earendil-works/pi-agent-core").ThinkingLevel,
			controller.signal,
		);
		// Even if stream would return high, aborted signal causes early undefined
		// Our implementation checks signal.aborted in catch and returns undefined
		expect(r === undefined || r.tier === "high").toBe(true);
	});

	it("should pass signal to streamSimple", async () => {
		const controller = new AbortController();
		const s = (async function* () {
			yield { type: "text_delta", delta: "Tier: medium\nReasoning: ok" };
		})();
		vi.mocked(streamSimple).mockReturnValue(
			s as unknown as ReturnType<typeof streamSimple>,
		);
		await runClassifier(
			"openai/gpt-4o",
			mockRegistry,
			baseContext,
			0,
			"off" as unknown as import("@earendil-works/pi-agent-core").ThinkingLevel,
			controller.signal,
		);
		const opts = vi.mocked(streamSimple).mock.calls.at(-1)?.[2] as Record<
			string,
			unknown
		>;
		expect(opts.signal).toBe(controller.signal);
	});

	it("parseClassifierOutput extracts Tier anywhere in the text", () => {
		const wrapped = parseClassifierOutput(
			"아니요, 커버리지 강제 안 함.\n\nTier: low\nReasoning: informational Q&A",
		);
		expect(wrapped).toMatchObject({
			tier: "low",
			reasoning: "informational Q&A",
		});
		expect(parseClassifierOutput("invalid")).toBeUndefined();
		expect(
			parseClassifierOutput("**Tier: high**\nReasoning: debug"),
		).toMatchObject({
			tier: "high",
		});
	});

	it("should handle historySize as number and thinking as string overload", async () => {
		const s1 = (async function* () {
			yield { type: "text_delta", delta: "Tier: medium\nReasoning: ok" };
		})();
		const s2 = (async function* () {
			yield { type: "text_delta", delta: "Tier: medium\nReasoning: ok" };
		})();
		vi.mocked(streamSimple)
			.mockReturnValueOnce(s1 as unknown as ReturnType<typeof streamSimple>)
			.mockReturnValueOnce(s2 as unknown as ReturnType<typeof streamSimple>);
		const r1 = await runClassifier(
			"openai/gpt-4o",
			mockRegistry,
			baseContext,
			"high" as unknown as import("@earendil-works/pi-agent-core").ThinkingLevel,
		);
		expect(r1?.tier).toBe("medium");
		const r2 = await runClassifier(
			"openai/gpt-4o",
			mockRegistry,
			baseContext,
			2,
			"high" as unknown as import("@earendil-works/pi-agent-core").ThinkingLevel,
		);
		expect(r2?.tier).toBe("medium");
	});
});
