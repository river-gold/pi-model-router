import type { Context } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RouterTier } from "./types";
import { parseCanonicalModelRef, isRouterTier } from "./config";
import { getLastUserText, getHistoryPairsText } from "./context";
import { logClassifierSync } from "./logger";
import { modelWithAuthBaseUrl, streamDelegated } from "./stream";

export const CLASSIFIER_SYSTEM_PROMPT = `You are a model router classifier. Your job is to categorize the user's latest request into one of six tiers: "minimal", "low", "medium", "high", "xhigh", or "max".

Tiers:
- minimal: Mechanical transforms with no judgment: format, typo, rename, indent, template fill, quote-from-context.
- low: Cheap language/lookup work: summaries, changelogs, commit messages, quick explanations, small bounded transforms, simple read-only lookup.
- medium: Execute a known plan: spec-following implementation, multi-file edits, focused debugging with known cause, tests/fixes, routine wiring.
- high: Local design under uncertainty: module architecture, planning, tradeoff analysis, broad debugging, large refactors, codebase research.
- xhigh: Cross-cutting or high-blast-radius work: migrations, ambiguous RCA, security-sensitive changes, multi-repo/system design, risky refactors.
- max: Novel or irreversible work: greenfield strategy, adversarial audit, long-horizon research with conflicting sources, eval/algorithm invention.

Do not answer the user's request. Do not use tools. Do not explain beyond the two lines.
Return ONLY these two lines and nothing else:
Tier: [minimal|low|medium|high|xhigh|max]
Reasoning: [one short sentence]`;

const OUTPUT_CONSTRAINT =
	"Classify the latest user message. Output ONLY two lines, no other text:\nTier: <minimal|low|medium|high|xhigh|max>\nReasoning: <one short sentence>";

const TIER_RE = /tier\s*[:：]\s*(minimal|low|medium|high|xhigh|max)\b/i;
const REASON_RE = /reasoning\s*[:：]\s*(.+)/i;

export const parseClassifierOutput = (
	fullText: string,
):
	| {
			tier: RouterTier;
			reasoning: string;
			tierLine: string;
			reasoningLine?: string;
	  }
	| undefined => {
	const trimmed = fullText.trim();
	if (!trimmed) return undefined;
	const tierMatch = trimmed.match(TIER_RE);
	if (!tierMatch) return undefined;
	const tierValue = tierMatch[1].toLowerCase();
/* v8 ignore next */
	if (!isRouterTier(tierValue)) return undefined;
	const reasonMatch = trimmed.match(REASON_RE);
	return {
		tier: tierValue,
		reasoning: reasonMatch?.[1]?.trim() || "Classifier decision.",
		tierLine: tierMatch[0].trim(),
		reasoningLine: reasonMatch?.[0]?.trim(),
	};
};

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
		const outcome = await runClassifierOutcome(
			entry.model,
			modelRegistry,
			context,
			historySize,
			entry.thinking,
			signal,
		);
		if (outcome.result)
			return {
				result: outcome.result,
				attempts: [
					...attempts,
					{ model: entry.model, thinking: entry.thinking },
				],
			};
		attempts.push({
			model: entry.model,
			thinking: entry.thinking,
/* v8 ignore next */
			error: outcome.error ?? "no tier parsed or model/auth/stream failed",
		});
		// Auth/stream/not-found skip the model for the rest of the session.
		// Parse-only failures are retried next turn (models often ignore format once then recover).
		if (outcome.skipSession) failedSet?.add(normalizedRef);
	}
	return { attempts };
};

type ClassifierOutcome = {
	result?: { tier: RouterTier; reasoning: string };
	skipSession: boolean;
	error?: string;
};

export const runClassifier = async (
	classifierModelRef: string,
	modelRegistry: ExtensionContext["modelRegistry"],
	context: Context,
	historySizeOrThinking?: number | ThinkingLevel,
	thinkingMaybe?: ThinkingLevel,
	signal?: AbortSignal,
): Promise<{ tier: RouterTier; reasoning: string } | undefined> => {
	const outcome = await runClassifierOutcome(
		classifierModelRef,
		modelRegistry,
		context,
		historySizeOrThinking,
		thinkingMaybe,
		signal,
	);
	return outcome.result;
};

const runClassifierOutcome = async (
	classifierModelRef: string,
	modelRegistry: ExtensionContext["modelRegistry"],
	context: Context,
	historySizeOrThinking?: number | ThinkingLevel,
	thinkingMaybe?: ThinkingLevel,
	signal?: AbortSignal,
): Promise<ClassifierOutcome> => {
	let historySize = 0;
	let thinking: ThinkingLevel | undefined;
	if (typeof historySizeOrThinking === "number") {
		historySize = historySizeOrThinking;
		thinking = thinkingMaybe;
	} else if (typeof historySizeOrThinking === "string") {
		thinking = historySizeOrThinking;
	}
	try {
		const { provider, modelId } = parseCanonicalModelRef(classifierModelRef);
		const model = modelRegistry.find(provider, modelId);
		if (!model) {
			const error = `model not found: ${provider}/${modelId}`;
			logClassifierSync({
				timestamp: new Date().toISOString(),
				model: classifierModelRef,
				thinking,
				fullText: "",
				success: false,
				error,
			});
			return { skipSession: true, error };
		}

		const auth = await modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok || !("apiKey" in auth) || !auth.apiKey) {
/* v8 ignore next */
			const error = `auth failed: ok=${auth.ok} hasKey=${"apiKey" in auth ? !!auth.apiKey : false}`;
			logClassifierSync({
				timestamp: new Date().toISOString(),
				model: classifierModelRef,
				thinking,
				fullText: "",
				success: false,
				error,
			});
			return { skipSession: true, error };
		}
		const apiKey = (auth as { apiKey: string }).apiKey;
		const headers = auth.headers;
		const requestModel = modelWithAuthBaseUrl(
			model,
			auth as { baseUrl?: string },
		);

		const promptText = getLastUserText(context);
		let body: string;
		if (historySize > 0) {
			const historyText = getHistoryPairsText(context, historySize);
			body = historyText
				? `Recent history (user+final result pairs):\n${historyText}\n\nLatest user message:\n${promptText}`.trim()
				: `Latest user message:\n${promptText}`.trim();
		} else {
			body = `Latest user message:\n${promptText}`.trim();
		}
		const classifierUserPrompt = `${OUTPUT_CONSTRAINT}\n\n${body}`;

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
/* v8 ignore next */
			if (
				event.type === "text_delta" &&
				"delta" in event &&
				typeof event.delta === "string"
			) {
				fullText += event.delta;
			}
		}

		const parsed = parseClassifierOutput(fullText);
		if (parsed) {
			logClassifierSync({
				timestamp: new Date().toISOString(),
				model: classifierModelRef,
				thinking,
				fullText,
				tierLine: parsed.tierLine,
				reasoningLine: parsed.reasoningLine,
				parsedTier: parsed.tier,
				success: true,
			});
			return {
				result: { tier: parsed.tier, reasoning: parsed.reasoning },
				skipSession: false,
			};
		}
		const parseError = "no tier parsed or isRouterTier false";
		logClassifierSync({
			timestamp: new Date().toISOString(),
			model: classifierModelRef,
			thinking,
			fullText,
			success: false,
			error: parseError,
		});
		return { skipSession: false, error: parseError };
	} catch (e) {
		if (signal?.aborted) {
			logClassifierSync({
				timestamp: new Date().toISOString(),
				model: classifierModelRef,
				thinking,
				fullText: "",
				success: false,
				error: "aborted",
			});
			return { skipSession: false, error: "aborted" };
		}
/* v8 ignore next */
		const error = e instanceof Error ? e.message : String(e);
		logClassifierSync({
			timestamp: new Date().toISOString(),
			model: classifierModelRef,
			thinking,
			fullText: "",
			success: false,
			error,
		});
		return { skipSession: true, error };
	}
};
