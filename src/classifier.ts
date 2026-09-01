import type { Context } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterTier } from "./types";
import { parseCanonicalModelRef, isRouterTier } from "./config";
import { getLastUserText, getHistoryPairsText } from "./context";
import { modelWithAuthBaseUrl, streamDelegated } from "./stream";

export const CLASSIFIER_SYSTEM_PROMPT = `You are a model router classifier. Your job is to categorize the user's latest request into one of six tiers: "minimal", "low", "medium", "high", "xhigh", or "max".

Tiers:
- minimal: Mechanical transforms with no judgment: format, typo, rename, indent, template fill, quote-from-context.
- low: Cheap language/lookup work: summaries, changelogs, commit messages, quick explanations, small bounded transforms, simple read-only lookup.
- medium: Execute a known plan: spec-following implementation, multi-file edits, focused debugging with known cause, tests/fixes, routine wiring.
- high: Local design under uncertainty: module architecture, planning, tradeoff analysis, broad debugging, large refactors, codebase research.
- xhigh: Cross-cutting or high-blast-radius work: migrations, ambiguous RCA, security-sensitive changes, multi-repo/system design, risky refactors.
- max: Novel or irreversible work: greenfield strategy, adversarial audit, long-horizon research with conflicting sources, eval/algorithm invention.

Return your decision in exactly two lines:
Tier: [minimal|low|medium|high|xhigh|max]
Reasoning: [one short sentence]`;

// Simplified overload: historySizeOrThinking accepts number (historySize) or
// ThinkingLevel (thinking only, historySize=0). New optional signal param allows
// caller (provider) to propagate AbortSignal for cancellation/timeout.
export type ClassifierAttempt = {
	model: string;
	thinking?: ThinkingLevel;
	error?: string;
};

export const runClassifierWithFallbacksDetailed = async (
	classifierModels: {
		model: string;
		thinking?: ThinkingLevel;
		source?: string;
	}[],
	modelRegistry: ExtensionContext["modelRegistry"],
	context: Context,
	historySize: number,
	signal?: AbortSignal,
	onAttempt?: (entry: {
		model: string;
		thinking?: ThinkingLevel;
		source?: string;
	}) => void,
	failedSet?: Set<string>,
): Promise<{
	result?: { tier: RouterTier; reasoning: string };
	attempts: ClassifierAttempt[];
}> => {
	const attempts: ClassifierAttempt[] = [];
	for (const entry of classifierModels) {
		const normalizedRef = entry.model.trim();
		if (failedSet?.has(normalizedRef)) {
			attempts.push({
				model: entry.model,
				thinking: entry.thinking,
				error: "skipped: failed this session (chain-local)",
			});
			continue;
		}
		onAttempt?.(entry);
		const result = await runClassifier(
			entry.model,
			modelRegistry,
			context,
			historySize,
			entry.thinking,
			signal,
		);
		if (result)
			return {
				result,
				attempts: [
					...attempts,
					{ model: entry.model, thinking: entry.thinking },
				],
			};
		if (signal?.aborted) {
			attempts.push({
				model: entry.model,
				thinking: entry.thinking,
				error: "aborted",
			});
		} else {
			attempts.push({
				model: entry.model,
				thinking: entry.thinking,
				error: "no tier parsed or model/auth/stream failed",
			});
			failedSet?.add(normalizedRef);
		}
	}
	return { attempts };
};

export const runClassifier = async (
	classifierModelRef: string,
	modelRegistry: ExtensionContext["modelRegistry"],
	context: Context,
	historySizeOrThinking?: number | ThinkingLevel,
	thinkingMaybe?: ThinkingLevel,
	signal?: AbortSignal,
): Promise<{ tier: RouterTier; reasoning: string } | undefined> => {
	let historySize = 0;
	let thinking: ThinkingLevel | undefined = undefined;
	if (typeof historySizeOrThinking === "number") {
		historySize = historySizeOrThinking;
		thinking = thinkingMaybe;
	} else if (typeof historySizeOrThinking === "string") {
		thinking = historySizeOrThinking;
	}
	try {
		const { provider, modelId } = parseCanonicalModelRef(classifierModelRef);
		const model = modelRegistry.find(provider, modelId);
		if (!model) return undefined;

		const auth = await modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok || !auth.apiKey) return undefined;
		const apiKey = auth.apiKey;
		const headers = auth.headers;
		const requestModel = modelWithAuthBaseUrl(
			model,
			auth as { baseUrl?: string },
		);

		const promptText = getLastUserText(context);
		let classifierUserPrompt: string;
		if (historySize > 0) {
			const historyText = getHistoryPairsText(context, historySize);
			classifierUserPrompt = historyText
				? `Recent history (user+final result pairs):\n${historyText}\n\nLatest user message:\n${promptText}`.trim()
				: `Latest user message:\n${promptText}`.trim();
		} else {
			classifierUserPrompt = `Latest user message:\n${promptText}`.trim();
		}

		const classifierContext: Context = {
			...context,
			systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
			tools: undefined,
			messages: [
				{ role: "user", content: classifierUserPrompt, timestamp: Date.now() },
			],
		};

		const reasoningOption =
			model.reasoning && thinking && thinking !== "off" ? thinking : undefined;

		const stream = streamDelegated(
			modelRegistry,
			requestModel,
			classifierContext,
			{
				apiKey,
				headers,
				...(reasoningOption ? { reasoning: reasoningOption } : {}),
				...(signal ? { signal } : {}),
			},
		);
		let fullText = "";
		for await (const event of stream) {
			if (
				event.type === "text_delta" &&
				"delta" in event &&
				typeof event.delta === "string"
			) {
				fullText += event.delta;
			}
		}

		const lines = fullText.trim().split("\n");
		const tierLine = lines.find((l) => l.toLowerCase().startsWith("tier:"));
		const reasoningLine = lines.find((l) =>
			l.toLowerCase().startsWith("reasoning:"),
		);

		if (tierLine) {
			const tierValue = tierLine.split(":")[1].trim().toLowerCase();
			if (isRouterTier(tierValue)) {
				const reasoningText = reasoningLine
					? reasoningLine.substring(reasoningLine.indexOf(":") + 1).trim()
					: "Classifier decision.";
				return {
					tier: tierValue,
					reasoning: reasoningText,
				};
			}
		}
	} catch {
		if (signal?.aborted) return undefined;
	}
	return undefined;
};
