import type { Context } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
	buildRoutingDecision,
	decideRouting,
	resolveAvailableTier,
	thinkingToTier,
} from "./routing";
import type { RouterProfile } from "./types";

describe("routing.ts", () => {
	describe("thinkingToTier", () => {
		it("maps thinking levels to tiers", () => {
			expect(thinkingToTier("max")).toBe("max");
			expect(thinkingToTier("xhigh")).toBe("xhigh");
			expect(thinkingToTier("high")).toBe("high");
			expect(thinkingToTier("medium")).toBe("medium");
			expect(thinkingToTier("low")).toBe("low");
			expect(thinkingToTier("minimal")).toBe("minimal");
			expect(thinkingToTier("off")).toBe("minimal");
		});
	});
	describe("resolveAvailableTier", () => {
		const _profile: RouterProfile = {
			medium: { models: ["openai/gpt-4o"] },
		};

		it("should return preferred if available", () => {
			expect(
				resolveAvailableTier(
					{ high: { models: ["a"] }, medium: { models: ["b"] } },
					"high",
				),
			).toBe("high");
		});

		it("should fall up if preferred is unavailable", () => {
			expect(resolveAvailableTier({ high: { models: ["a"] } }, "low")).toBe(
				"high",
			);
		});

		it("should fall down if falling up finds nothing", () => {
			expect(resolveAvailableTier({ low: { models: ["a"] } }, "medium")).toBe(
				"low",
			);
		});

		it("should fall from missing minimal to low", () => {
			expect(
				resolveAvailableTier(
					{ low: { models: ["a"] }, medium: { models: ["b"] } },
					"minimal",
				),
			).toBe("low");
		});
	});

	describe("buildRoutingDecision", () => {
		const profile: RouterProfile = {
			high: { models: ["openai/gpt-4o-pro"], thinking: "high" },
		};

		it("should construct correct decision object", () => {
			const decision = buildRoutingDecision(
				"balanced",
				profile,
				"high",
				"Reasoning string",
			);
			expect(decision.profile).toBe("balanced");
			expect(decision.tier).toBe("high");
			expect(decision.targetProvider).toBe("openai");
			expect(decision.targetModelId).toBe("gpt-4o-pro");
			expect(decision.targetLabel).toBe("openai/gpt-4o-pro");
			expect(decision.thinking).toBe("high");
			expect(decision.reasoning).toBe("Reasoning string");
		});

		it("should throw if tier is not in profile", () => {
			expect(() =>
				buildRoutingDecision("balanced", profile, "medium", "Reason"),
			).toThrow();
		});
	});

	describe("decideRouting", () => {
		const profile: RouterProfile = {
			high: { models: ["openai/gpt-4o"], resolvedContextWindow: 100 },
			medium: { models: ["openai/gpt-4o-mini"], resolvedContextWindow: 100 },
			low: { models: ["openai/gpt-4o-micro"], resolvedContextWindow: 100 },
		};

		it("should always return medium", () => {
			const ctx: Context = {
				messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
			};
			const d = decideRouting(ctx, "p", profile, undefined);
			expect(d.tier).toBe("medium");
			expect(d.reasoning).toContain("Defaulted to medium");
		});

		it("should always return medium regardless of previous decision", () => {
			const ctx: Context = {
				messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
			};
			const prev = buildRoutingDecision("p", profile, "high", "prev");
			const d = decideRouting(ctx, "p", profile, prev);
			expect(d.tier).toBe("medium");
		});
	});
});
