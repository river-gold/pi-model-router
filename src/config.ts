import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type {
	RouterConfig,
	RouterProfile,
	RoutedTierConfig,
	ConfigLoadResult,
	ParsedConfigFile,
	RouterTier,
	ClassifierConfig,
} from "./types";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from "./constants";

export const ROUTER_TIERS = [
	"max",
	"xhigh",
	"high",
	"medium",
	"low",
	"minimal",
] as const;

export const DEFAULT_HISTORY_SIZE = 0;

export const isObjectRecord = (
	value: unknown,
): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const isRouterTier = (value: unknown): value is RouterTier =>
	(ROUTER_TIERS as readonly string[]).includes(value as string);

export const stripJsonc = (text: string): string => {
	let result = "";
	let inString = false;
	let stringChar = "";
	let escaped = false;
	let inSingleLineComment = false;
	let inBlockComment = false;

	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		const nextChar = text[i + 1] ?? "";

		if (inSingleLineComment) {
			if (char === "\n") {
				inSingleLineComment = false;
				result += char;
			}
			continue;
		}

		if (inBlockComment) {
			if (char === "*" && nextChar === "/") {
				inBlockComment = false;
				i++;
			}
			continue;
		}

		if (inString) {
			result += char;
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === stringChar) {
				inString = false;
			}
			continue;
		}

		if (char === '"' || char === "'") {
			inString = true;
			stringChar = char;
			result += char;
			continue;
		}

		if (char === "/" && nextChar === "/") {
			inSingleLineComment = true;
			i++;
			continue;
		}

		if (char === "/" && nextChar === "*") {
			inBlockComment = true;
			i++;
			continue;
		}

		result += char;
	}

	let stripped = "";
	inString = false;
	stringChar = "";
	escaped = false;
	for (let i = 0; i < result.length; i++) {
		const char = result[i];
		if (inString) {
			stripped += char;
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === stringChar) {
				inString = false;
			}
			continue;
		}
		if (char === '"' || char === "'") {
			inString = true;
			stringChar = char;
			stripped += char;
			continue;
		}
		if (char === ",") {
			let j = i + 1;
			for (; j < result.length && /\s/.test(result[j] ?? ""); j++) {}
			const nextNonSpace = result[j] ?? "";
			if (nextNonSpace === "}" || nextNonSpace === "]") {
				continue;
			}
		}
		stripped += char;
	}

	return stripped;
};

export const parseConfigFile = (path: string): ParsedConfigFile => {
	if (!existsSync(path)) {
		return { config: {}, warnings: [] };
	}

	try {
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(stripJsonc(raw)) as unknown;
		if (!isObjectRecord(parsed)) {
			return {
				config: {},
				warnings: [`Ignored router config at ${path}: expected a JSON object.`],
			};
		}
		return { config: parsed as Partial<RouterConfig>, warnings: [] };
	} catch (error) {
		return {
			config: {},
			warnings: [
				`Failed to parse router config at ${path}: ${error instanceof Error ? error.message : String(error)}`,
			],
		};
	}
};

const mergeTier = (
	existing?: RoutedTierConfig,
	next?: Partial<RoutedTierConfig>,
): RoutedTierConfig | undefined => {
	if (!existing && !next) return undefined;
	if (!next) return existing;
	if (!existing) return next as RoutedTierConfig;
	return { ...existing, ...next };
};

export const normalizeClassifierConfig = (
	raw: unknown,
	warnings: string[],
	contextLabel: string,
): ClassifierConfig | undefined => {
	if (typeof raw === "string" && raw.trim()) {
		try {
			const { provider, modelId, thinking } = parseCanonicalModelRef(
				raw.trim(),
			);
			return { model: formatModelRef(provider, modelId), thinking };
		} catch (error) {
			warnings.push(
				`Invalid ${contextLabel}: ${error instanceof Error ? error.message : String(error)}`,
			);
			return undefined;
		}
	}
	if (isObjectRecord(raw)) {
		const modelRef = typeof raw.model === "string" ? raw.model.trim() : "";
		if (modelRef) {
			if (raw.thinking !== undefined) {
				warnings.push(
					`${contextLabel}: separate "thinking" field is removed, use "model#thinking" format. Ignored.`,
				);
			}
			try {
				const { provider, modelId, thinking } =
					parseCanonicalModelRef(modelRef);
				return { model: formatModelRef(provider, modelId), thinking };
			} catch (error) {
				warnings.push(
					`Invalid ${contextLabel}: ${error instanceof Error ? error.message : String(error)}`,
				);
				return undefined;
			}
		}
		warnings.push(
			`${contextLabel} object is missing the "model" field. Ignored.`,
		);
		return undefined;
	}
	return undefined;
};

export const normalizeClassifierModels = (
	raw: unknown,
	warnings: string[],
	contextLabel: string,
): ClassifierConfig[] | undefined => {
	if (raw === undefined) return undefined;
	if (typeof raw === "string") {
		const single = normalizeClassifierConfig(raw, warnings, contextLabel);
		return single ? [single] : undefined;
	}
	if (Array.isArray(raw)) {
		const out: ClassifierConfig[] = [];
		for (let i = 0; i < raw.length; i++) {
			const c = normalizeClassifierConfig(
				raw[i],
				warnings,
				`${contextLabel}[${i}]`,
			);
			if (c) out.push(c);
		}
		return out.length > 0 ? out : undefined;
	}
	if (isObjectRecord(raw)) {
		// support legacy { model, thinking } object as single entry
		const single = normalizeClassifierConfig(raw, warnings, contextLabel);
		return single ? [single] : undefined;
	}
	warnings.push(
		`Invalid ${contextLabel}: expected string or array of strings.`,
	);
	return undefined;
};

export type ClassifierSource = "profile" | "global" | "low tier";

export type ClassifierEntry = ClassifierConfig & { source: ClassifierSource };

export const resolveEffectiveClassifier = (
	profile: RouterProfile,
	globalClassifiers: ClassifierConfig[] | undefined,
): { classifiers: ClassifierEntry[] | undefined; source: string } => {
	const chain: ClassifierEntry[] = [];
	const sources: string[] = [];

	if (profile.classifierModels && profile.classifierModels.length > 0) {
		chain.push(
			...profile.classifierModels.map((c) => ({
				...c,
				source: "profile" as const,
			})),
		);
		sources.push("profile");
	}
	if (globalClassifiers && globalClassifiers.length > 0) {
		chain.push(
			...globalClassifiers.map((c) => ({ ...c, source: "global" as const })),
		);
		sources.push("global");
	}
	// Fallback: use the low tier models as the classifier chain (follows low tier config).
	const lowModels = profile.low?.models;
	if (lowModels && lowModels.length > 0) {
		chain.push(
			...lowModels.map((m) => {
				const { provider, modelId, thinking } = parseCanonicalModelRef(m);
				return {
					model: formatModelRef(provider, modelId),
					thinking,
					source: "low tier" as const,
				};
			}),
		);
		sources.push("low tier");
	}

	return {
		classifiers: chain.length > 0 ? chain : undefined,
		source: sources.length > 0 ? sources.join(" → ") : "none",
	};
};

export const mergeConfig = (
	base: RouterConfig,
	override: Partial<RouterConfig>,
): RouterConfig => {
	const mergedProfiles: Record<string, RouterProfile> = { ...base.profiles };
	for (const [name, profile] of Object.entries(override.profiles ?? {})) {
		if (!isObjectRecord(profile)) {
			continue;
		}
		const existing = mergedProfiles[name];
		const nextProfile = profile as Partial<RouterProfile>;
		mergedProfiles[name] = {
			max: mergeTier(existing?.max, nextProfile.max),
			xhigh: mergeTier(existing?.xhigh, nextProfile.xhigh),
			high: mergeTier(existing?.high, nextProfile.high),
			medium: mergeTier(existing?.medium, nextProfile.medium),
			low: mergeTier(existing?.low, nextProfile.low),
			minimal: mergeTier(existing?.minimal, nextProfile.minimal),
			classifierModels:
				(nextProfile.classifierModels as ClassifierConfig[] | undefined) ??
				existing?.classifierModels,
		};
	}

	// historyLimit is a legacy alias for historySize (kept for backwards compatibility)
	const mergedHistorySize =
		(override as unknown as Record<string, unknown>).historySize !== undefined
			? ((override as unknown as Record<string, unknown>).historySize as number)
			: (override as unknown as Record<string, unknown>).historyLimit !==
					undefined
				? ((override as unknown as Record<string, unknown>)
						.historyLimit as number)
				: base.historySize;

	return {
		debug: override.debug ?? base.debug,
		classifierModels: override.classifierModels ?? base.classifierModels,
		historySize: mergedHistorySize ?? base.historySize,
		profiles: mergedProfiles,
	};
};

const ALLOWED_THINKING = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

export const parseCanonicalModelRef = (
	value: string,
): { provider: string; modelId: string; thinking?: ThinkingLevel } => {
	const hashIndex = value.indexOf("#");
	const rawRef = hashIndex === -1 ? value : value.slice(0, hashIndex);
	const thinkingRaw =
		hashIndex === -1 ? undefined : value.slice(hashIndex + 1).trim();
	const slashIndex = rawRef.indexOf("/");
	if (slashIndex === -1) {
		throw new Error(
			`Invalid model reference "${value}". Expected "provider/model[#thinking]".`,
		);
	}
	const provider = rawRef.slice(0, slashIndex).trim();
	const modelId = rawRef.slice(slashIndex + 1).trim();
	if (!provider || !modelId) {
		throw new Error(
			`Invalid model reference "${value}". Expected "provider/model[#thinking]".`,
		);
	}
	if (thinkingRaw !== undefined) {
		if (
			thinkingRaw &&
			!(ALLOWED_THINKING as readonly string[]).includes(thinkingRaw)
		) {
			throw new Error(
				`Invalid thinking "${thinkingRaw}": expected one of ${ALLOWED_THINKING.join(", ")}.`,
			);
		}
	}
	return {
		provider,
		modelId,
		...(thinkingRaw ? { thinking: thinkingRaw as ThinkingLevel } : {}),
	};
};

export const formatModelRef = (
	provider: string,
	modelId: string,
	thinking?: ThinkingLevel,
): string =>
	thinking ? `${provider}/${modelId}#${thinking}` : `${provider}/${modelId}`;

export const normalizeTierConfig = (
	value: unknown,
	profileName: string,
	tier: RouterTier,
	warnings: string[],
): RoutedTierConfig | undefined => {
	if (!isObjectRecord(value)) {
		return undefined;
	}

	if (value.thinking !== undefined) {
		warnings.push(
			`Profile "${profileName}" ${tier} tier: separate "thinking" field is removed, use "model#thinking" format. Ignored.`,
		);
	}
	if (value.fallbacks !== undefined) {
		warnings.push(
			`Profile "${profileName}" ${tier} tier: "fallbacks" is removed, use "models" array with priority order. Ignored.`,
		);
	}
	if (typeof value.model === "string") {
		warnings.push(
			`Profile "${profileName}" ${tier} tier: "model" is removed, use "models" array. Ignored.`,
		);
	}

	const rawModels = (value as Record<string, unknown>).models;
	if (!Array.isArray(rawModels) || rawModels.length === 0) {
		warnings.push(
			`Profile "${profileName}" ${tier} tier is missing "models" array. Tier disabled.`,
		);
		return undefined;
	}

	const models: string[] = [];
	for (const m of rawModels) {
		if (typeof m !== "string" || !m.trim()) {
			warnings.push(
				`Invalid model entry "${String(m)}" in profile "${profileName}" ${tier} tier.`,
			);
			continue;
		}
		try {
			parseCanonicalModelRef(m.trim());
			models.push(m.trim());
		} catch (error) {
			warnings.push(
				`Invalid model "${m}" in profile "${profileName}" ${tier} tier: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	if (models.length === 0) {
		warnings.push(
			`Profile "${profileName}" ${tier} tier has no valid models. Tier disabled.`,
		);
		return undefined;
	}

	const primaryParsed = parseCanonicalModelRef(models[0]);
	const parsedModel = formatModelRef(
		primaryParsed.provider,
		primaryParsed.modelId,
	);
	const thinking = primaryParsed.thinking;

	const tierContextWindow =
		typeof value.contextWindow === "number" && value.contextWindow > 0
			? value.contextWindow
			: undefined;
	const resolvedContextWindow = tierContextWindow ?? DEFAULT_CONTEXT_WINDOW;

	const tierMaxTokens =
		typeof value.maxTokens === "number" && value.maxTokens > 0
			? value.maxTokens
			: undefined;
	const resolvedMaxTokens = tierMaxTokens ?? DEFAULT_MAX_TOKENS;

	const tierReasoning =
		typeof value.reasoning === "boolean" ? value.reasoning : undefined;

	return {
		models,
		model: parsedModel,
		thinking,
		contextWindow: tierContextWindow,
		maxTokens: tierMaxTokens,
		reasoning: tierReasoning,
		resolvedContextWindow,
		resolvedMaxTokens,
	};
};

export const normalizeConfig = (raw: RouterConfig): ConfigLoadResult => {
	const warnings: string[] = [];

	// Warn on unknown top-level fields
	{
		const allowedKeys = new Set([
			"debug",
			"classifierModels",
			"classifierModel",
			"historySize",
			"historyLimit",
			"profiles",
		]);
		for (const key of Object.keys(raw as unknown as Record<string, unknown>)) {
			if (!allowedKeys.has(key)) {
				warnings.push(`Unknown config field "${key}" ignored.`);
			}
		}
	}

	const normalizedProfiles: Record<string, RouterProfile> = {};

	for (const [name, profile] of Object.entries(raw.profiles ?? {})) {
		if (!isObjectRecord(profile)) {
			warnings.push(`Profile "${name}" is not an object. Skipped.`);
			continue;
		}
		const max = normalizeTierConfig(
			(profile as Record<string, unknown>).max,
			name,
			"max",
			warnings,
		);
		const xhigh = normalizeTierConfig(
			(profile as Record<string, unknown>).xhigh,
			name,
			"xhigh",
			warnings,
		);
		const high = normalizeTierConfig(profile?.high, name, "high", warnings);
		const medium = normalizeTierConfig(
			profile?.medium,
			name,
			"medium",
			warnings,
		);
		const low = normalizeTierConfig(profile?.low, name, "low", warnings);
		const minimal = normalizeTierConfig(
			(profile as Record<string, unknown>).minimal,
			name,
			"minimal",
			warnings,
		);

		if (!max && !xhigh && !high && !medium && !low && !minimal) {
			warnings.push(`Profile "${name}" has no valid tiers. Skipped.`);
			continue;
		}

		if ((profile as Record<string, unknown>).classifierModel !== undefined) {
			warnings.push(
				`Profile "${name}" classifierModel is deprecated, use classifierModels.`,
			);
		}
		const rawClassifier =
			(profile as Record<string, unknown>).classifierModels ??
			(profile as Record<string, unknown>).classifierModel;
		const classifierModels = normalizeClassifierModels(
			rawClassifier,
			warnings,
			`Profile "${name}" classifierModels`,
		);

		normalizedProfiles[name] = {
			...(max ? { max } : {}),
			...(xhigh ? { xhigh } : {}),
			high,
			medium,
			low,
			...(minimal ? { minimal } : {}),
			...(classifierModels ? { classifierModels } : {}),
		};
	}

	if (
		(raw as unknown as Record<string, unknown>).classifierModel !== undefined
	) {
		warnings.push("classifierModel is deprecated, use classifierModels.");
	}
	const rawGlobalClassifier =
		(raw as unknown as Record<string, unknown>).classifierModels ??
		(raw as unknown as Record<string, unknown>).classifierModel;
	const classifierModels = normalizeClassifierModels(
		rawGlobalClassifier as unknown,
		warnings,
		"classifierModels",
	);

	let historySize: number | undefined = undefined;
	const rawHistorySize =
		(raw as unknown as Record<string, unknown>).historySize ??
		(raw as unknown as Record<string, unknown>).historyLimit;
	if (rawHistorySize !== undefined) {
		if (
			typeof rawHistorySize === "number" &&
			Number.isInteger(rawHistorySize) &&
			rawHistorySize >= 0 &&
			rawHistorySize <= 20
		) {
			historySize = rawHistorySize;
		} else {
			warnings.push(
				`Invalid historySize "${String(rawHistorySize)}": expected integer between 0 and 20. Using default ${DEFAULT_HISTORY_SIZE}.`,
			);
			historySize = DEFAULT_HISTORY_SIZE;
		}
	}

	return {
		config: {
			debug: typeof raw.debug === "boolean" ? raw.debug : false,
			classifierModels,
			historySize: historySize ?? DEFAULT_HISTORY_SIZE,
			profiles: normalizedProfiles,
		},
		warnings,
	};
};

export const loadRouterConfig = (cwd: string): ConfigLoadResult => {
	const globalJsonPath = join(getAgentDir(), "model-router.json");
	const globalJsoncPath = join(getAgentDir(), "model-router.jsonc");
	const projectJsonPath = join(cwd, ".pi", "model-router.json");
	const projectJsoncPath = join(cwd, ".pi", "model-router.jsonc");
	const globalJsonResult = parseConfigFile(globalJsonPath);
	const globalJsoncResult = parseConfigFile(globalJsoncPath);
	const projectJsonResult = parseConfigFile(projectJsonPath);
	const projectJsoncResult = parseConfigFile(projectJsoncPath);
	const baseConfig: RouterConfig = { profiles: {} };
	let merged = mergeConfig(baseConfig, globalJsonResult.config);
	merged = mergeConfig(merged, globalJsoncResult.config);
	merged = mergeConfig(merged, projectJsonResult.config);
	merged = mergeConfig(merged, projectJsoncResult.config);
	const normalized = normalizeConfig(merged);
	return {
		config: normalized.config,
		warnings: [
			...globalJsonResult.warnings,
			...globalJsoncResult.warnings,
			...projectJsonResult.warnings,
			...projectJsoncResult.warnings,
			...normalized.warnings,
		],
	};
};

export const profileNames = (config: RouterConfig): string[] => {
	return Object.keys(config.profiles).sort();
};

export const resolveProfileName = (
	config: RouterConfig,
	requested?: string,
): string | undefined => {
	if (requested && config.profiles[requested]) {
		return requested;
	}
	return undefined;
};

export const resolveContextWindow = (
	tier: RouterTier,
	profile: RouterProfile,
	modelRegistry: ExtensionContext["modelRegistry"] | undefined,
): number => {
	const tierConfig = profile[tier];
	if (!tierConfig) return DEFAULT_CONTEXT_WINDOW;

	// User-specified contextWindow takes precedence over registry
	if (tierConfig.contextWindow !== undefined && tierConfig.contextWindow > 0) {
		return tierConfig.contextWindow;
	}

	if (modelRegistry) {
		try {
			const ref = tierConfig.models!?.[0] ?? tierConfig.model ?? "";
			const { provider, modelId } = parseCanonicalModelRef(ref);
			const registryModel = modelRegistry.find(provider, modelId);
			if (registryModel?.contextWindow) return registryModel.contextWindow;
		} catch {
			/* ignore */
		}
	}

	return tierConfig.resolvedContextWindow ?? DEFAULT_CONTEXT_WINDOW;
};

export const resolveMaxTokens = (
	tier: RouterTier,
	profile: RouterProfile,
	modelRegistry: ExtensionContext["modelRegistry"] | undefined,
): number => {
	const tierConfig = profile[tier];
	if (!tierConfig) return DEFAULT_MAX_TOKENS;

	// User-specified maxTokens takes precedence over registry
	if (tierConfig.maxTokens !== undefined && tierConfig.maxTokens > 0) {
		return tierConfig.maxTokens;
	}

	if (modelRegistry) {
		try {
			const ref = tierConfig.models!?.[0] ?? tierConfig.model ?? "";
			const { provider, modelId } = parseCanonicalModelRef(ref);
			const registryModel = modelRegistry.find(provider, modelId);
			if (registryModel?.maxTokens) return registryModel.maxTokens;
		} catch {
			/* ignore */
		}
	}

	return tierConfig.resolvedMaxTokens ?? DEFAULT_MAX_TOKENS;
};

export const resolveDelegatedReasoning = (
	model: Model<Api>,
	requested: string | undefined,
): string | undefined => {
	if (!requested || !model.reasoning) return undefined;
	if (requested === "off") return undefined;
	return requested;
};
