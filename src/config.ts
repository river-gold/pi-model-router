import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import type {
  RouterConfig,
  RouterProfile,
  RoutedTierConfig,
  ConfigLoadResult,
  ParsedConfigFile,
  RouterTier,
  RoutingRule,
  ClassifierConfig,
  VectorCacheConfig,
} from './types';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
} from './constants';

export const ROUTER_TIERS = ['high', 'medium', 'low'] as const;

export const ROUTER_PIN_VALUES = ['auto', 'high', 'medium', 'low'] as const;

export const DEFAULT_VECTOR_THRESHOLD = 0.75;
export const DEFAULT_VECTOR_FILE = 'router-vectors.db';
export const DEFAULT_EMBEDDING_MODEL = 'qwen3-embedding:0.6b';
export const DEFAULT_EMBEDDING_BASE_URL = 'http://localhost:11434';
export const DEFAULT_VECTOR_DIMENSIONS = 1024;
export const DEFAULT_EMBEDDING_CONTEXT_WINDOW = 8192;

export const isObjectRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isRouterTier = (value: unknown): value is RouterTier =>
  value === 'high' || value === 'medium' || value === 'low';

export const stripJsonc = (text: string): string => {
  let result = '';
  let inString = false;
  let stringChar = '';
  let escaped = false;
  let inSingleLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1] ?? '';

    if (inSingleLineComment) {
      if (char === '\n') {
        inSingleLineComment = false;
        result += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
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

    if (char === '/' && nextChar === '/') {
      inSingleLineComment = true;
      i++;
      continue;
    }

    if (char === '/' && nextChar === '*') {
      inBlockComment = true;
      i++;
      continue;
    }

    result += char;
  }

  // Remove trailing commas before } or ]
  let stripped = '';
  inString = false;
  stringChar = '';
  escaped = false;
  for (let i = 0; i < result.length; i++) {
    const char = result[i];
    if (inString) {
      stripped += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
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
    if (char === ',') {
      let j = i + 1;
      while (j < result.length && /\s/.test(result[j] ?? '')) j++;
      const nextNonSpace = result[j] ?? '';
      if (nextNonSpace === '}' || nextNonSpace === ']') {
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
    const raw = readFileSync(path, 'utf-8');
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
  if (typeof raw === 'string' && raw.trim()) {
    try {
      parseCanonicalModelRef(raw.trim());
      return { model: raw.trim() };
    } catch (error) {
      warnings.push(
        `Invalid ${contextLabel}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }
  if (isObjectRecord(raw)) {
    const modelRef = typeof raw.model === 'string' ? raw.model.trim() : '';
    if (modelRef) {
      try {
        parseCanonicalModelRef(modelRef);
        const thinking =
          typeof raw.thinking === 'string' && raw.thinking.length > 0
            ? (raw.thinking as ThinkingLevel)
            : undefined;
        return { model: modelRef, thinking };
      } catch (error) {
        warnings.push(
          `Invalid ${contextLabel}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      }
    }
    warnings.push(`${contextLabel} object is missing the "model" field. Ignored.`);
    return undefined;
  }
  return undefined;
};

export const normalizeVectorCacheConfig = (
  raw: unknown,
  warnings: string[],
): VectorCacheConfig | undefined => {
  if (raw === undefined || raw === null) return undefined;
  if (!isObjectRecord(raw)) {
    warnings.push(`Invalid vectorCache config: expected an object. Ignored.`);
    return undefined;
  }

  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : true;

  let threshold = DEFAULT_VECTOR_THRESHOLD;
  if (raw.threshold !== undefined) {
    if (typeof raw.threshold === 'number' && raw.threshold >= 0 && raw.threshold <= 1) {
      threshold = raw.threshold;
    } else {
      warnings.push(`Invalid vectorCache.threshold "${String(raw.threshold)}": expected number between 0 and 1. Using default ${DEFAULT_VECTOR_THRESHOLD}.`);
    }
  }

  let vectorFile = DEFAULT_VECTOR_FILE;
  if (typeof raw.vectorFile === 'string' && raw.vectorFile.trim()) {
    vectorFile = raw.vectorFile.trim();
  } else if (raw.vectorFile !== undefined) {
    warnings.push(`Invalid vectorCache.vectorFile: expected non-empty string. Using default "${DEFAULT_VECTOR_FILE}".`);
  }
  // Alias: allow "vectorPath" or "file" as alternative keys
  if (typeof raw.vectorPath === 'string' && raw.vectorPath.trim() && vectorFile === DEFAULT_VECTOR_FILE) {
    vectorFile = (raw.vectorPath as string).trim();
  }
  if (typeof raw.file === 'string' && raw.file.trim() && vectorFile === DEFAULT_VECTOR_FILE) {
    vectorFile = (raw.file as string).trim();
  }

  let embeddingModel = DEFAULT_EMBEDDING_MODEL;
  if (typeof raw.embeddingModel === 'string' && raw.embeddingModel.trim()) {
    embeddingModel = raw.embeddingModel.trim();
  } else if (typeof raw.model === 'string' && raw.model.trim() && embeddingModel === DEFAULT_EMBEDDING_MODEL) {
    embeddingModel = (raw.model as string).trim();
  } else if (raw.embeddingModel !== undefined) {
    warnings.push(`Invalid vectorCache.embeddingModel: expected non-empty string. Using default "${DEFAULT_EMBEDDING_MODEL}".`);
  }

  let embeddingBaseUrl = DEFAULT_EMBEDDING_BASE_URL;
  if (typeof raw.embeddingBaseUrl === 'string' && raw.embeddingBaseUrl.trim()) {
    embeddingBaseUrl = raw.embeddingBaseUrl.trim().replace(/\/+$/, '');
  } else if (typeof raw.baseUrl === 'string' && raw.baseUrl.trim() && embeddingBaseUrl === DEFAULT_EMBEDDING_BASE_URL) {
    embeddingBaseUrl = (raw.baseUrl as string).trim().replace(/\/+$/, '');
  } else if (raw.embeddingBaseUrl !== undefined || raw.baseUrl !== undefined) {
    // only warn if provided but invalid type
    if (raw.embeddingBaseUrl !== undefined && typeof raw.embeddingBaseUrl !== 'string') {
      warnings.push(`Invalid vectorCache.embeddingBaseUrl: expected string. Using default "${DEFAULT_EMBEDDING_BASE_URL}".`);
    }
  }

  const backgroundRefresh = typeof raw.backgroundRefresh === 'boolean' ? raw.backgroundRefresh : false;

  let dimensions = DEFAULT_VECTOR_DIMENSIONS;
  if (raw.dimensions !== undefined) {
    if (typeof raw.dimensions === 'number' && Number.isInteger(raw.dimensions) && raw.dimensions > 0 && raw.dimensions <= 4096) {
      dimensions = raw.dimensions;
    } else {
      warnings.push(`Invalid vectorCache.dimensions "${String(raw.dimensions)}": expected integer between 1 and 4096. Using default ${DEFAULT_VECTOR_DIMENSIONS}.`);
    }
  }

  const keepAlive = typeof raw.keepAlive === 'string' && raw.keepAlive.trim() ? raw.keepAlive.trim() : undefined;

  let embeddingContextWindow = DEFAULT_EMBEDDING_CONTEXT_WINDOW;
  const rawContextWindow =
    raw.embeddingContextWindow ??
    raw.embeddingContextSize ??
    raw.contextWindow ??
    raw.contextSize ??
    raw.maxTokens;
  if (rawContextWindow !== undefined) {
    if (
      typeof rawContextWindow === 'number' &&
      Number.isInteger(rawContextWindow) &&
      rawContextWindow > 0 &&
      rawContextWindow <= 100000
    ) {
      embeddingContextWindow = rawContextWindow;
    } else {
      warnings.push(
        `Invalid vectorCache.embeddingContextWindow "${String(rawContextWindow)}": expected integer between 1 and 100000. Using default ${DEFAULT_EMBEDDING_CONTEXT_WINDOW}.`,
      );
    }
  }

  return {
    enabled,
    threshold,
    vectorFile,
    embeddingModel,
    embeddingBaseUrl,
    backgroundRefresh,
    dimensions,
    embeddingContextWindow,
    ...(keepAlive ? { keepAlive } : {}),
  };
};

export const resolveEffectiveClassifier = (
  profile: RouterProfile,
  globalClassifier: ClassifierConfig | undefined,
): ClassifierConfig | undefined => {
  if (profile.classifierModel) return profile.classifierModel;
  if (globalClassifier) return globalClassifier;
  if (profile.low) return { model: profile.low.model, thinking: profile.low.thinking };
  return undefined;
};

export const mergeConfig = (
  base: RouterConfig,
  override: Partial<RouterConfig>,
): RouterConfig => {
  const mergedProfiles: Record<string, RouterProfile> = { ...base.profiles };
  for (const [name, profile] of Object.entries(override.profiles ?? {})) {
    const existing = mergedProfiles[name];
    const nextProfile = profile as Partial<RouterProfile>;
    mergedProfiles[name] = {
      high: mergeTier(existing?.high, nextProfile.high),
      medium: mergeTier(existing?.medium, nextProfile.medium),
      low: mergeTier(existing?.low, nextProfile.low),
      classifierModel: (nextProfile.classifierModel as ClassifierConfig | undefined) ?? existing?.classifierModel,
    };
  }

  // Merge vectorCache: shallow merge, override wins per field
  let mergedVectorCache: VectorCacheConfig | undefined = base.vectorCache;
  if (override.vectorCache !== undefined) {
    if (isObjectRecord(override.vectorCache) && isObjectRecord(base.vectorCache)) {
      mergedVectorCache = { ...base.vectorCache, ...override.vectorCache } as VectorCacheConfig;
    } else if (override.vectorCache !== undefined) {
      mergedVectorCache = override.vectorCache as VectorCacheConfig;
    }
  }

  return {
    debug: override.debug ?? base.debug,
    classifierModel: override.classifierModel ?? base.classifierModel,
    rules: override.rules ?? base.rules,
    profiles: mergedProfiles,
    ...(mergedVectorCache ? { vectorCache: mergedVectorCache } : {}),
  };
};

export const parseCanonicalModelRef = (
  value: string,
): { provider: string; modelId: string } => {
  const slashIndex = value.indexOf('/');
  if (slashIndex === -1) {
    throw new Error(
      `Invalid model reference "${value}". Expected "provider/model".`,
    );
  }
  const provider = value.slice(0, slashIndex).trim();
  const modelId = value.slice(slashIndex + 1).trim();
  if (!provider || !modelId) {
    throw new Error(
      `Invalid model reference "${value}". Expected "provider/model".`,
    );
  }
  return { provider, modelId };
};

export const normalizeTierConfig = (
  value: unknown,
  profileName: string,
  tier: RouterTier,
  warnings: string[],
): RoutedTierConfig | undefined => {
  if (!isObjectRecord(value)) {
    return undefined;
  }

  const rawModel = typeof value.model === 'string' ? value.model.trim() : '';

  if (!rawModel) {
    warnings.push(
      `Profile "${profileName}" ${tier} tier is missing a model. Tier disabled.`,
    );
    return undefined;
  }

  let parsedModel: string;
  try {
    parseCanonicalModelRef(rawModel);
    parsedModel = rawModel;
  } catch (error) {
    warnings.push(
      `Profile "${profileName}" ${tier} tier: ${error instanceof Error ? error.message : String(error)} Tier disabled.`,
    );
    return undefined;
  }

  const thinking = typeof value.thinking === 'string' && value.thinking.length > 0
    ? (value.thinking as ThinkingLevel)
    : 'medium';

  let fallbacks: string[] | undefined = undefined;
  if (Array.isArray(value.fallbacks)) {
    fallbacks = [];
    for (const f of value.fallbacks) {
      if (typeof f === 'string') {
        try {
          parseCanonicalModelRef(f);
          fallbacks.push(f);
        } catch (error) {
          warnings.push(
            `Invalid fallback model "${f}" in profile "${profileName}" ${tier} tier: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  const tierContextWindow =
    typeof value.contextWindow === 'number' && value.contextWindow > 0
      ? value.contextWindow
      : undefined;
  const resolvedContextWindow = tierContextWindow ?? DEFAULT_CONTEXT_WINDOW;

  const tierMaxTokens =
    typeof value.maxTokens === 'number' && value.maxTokens > 0
      ? value.maxTokens
      : undefined;
  const resolvedMaxTokens = tierMaxTokens ?? DEFAULT_MAX_TOKENS;

  const tierReasoning =
    typeof value.reasoning === 'boolean' ? value.reasoning : undefined;

  return {
    model: parsedModel,
    thinking,
    fallbacks,
    contextWindow: tierContextWindow,
    maxTokens: tierMaxTokens,
    reasoning: tierReasoning,
    resolvedContextWindow,
    resolvedMaxTokens,
  };
};

export const normalizeConfig = (raw: RouterConfig): ConfigLoadResult => {
  const warnings: string[] = [];

  const normalizedProfiles: Record<string, RouterProfile> = {};

  for (const [name, profile] of Object.entries(raw.profiles ?? {})) {
    const high = normalizeTierConfig(profile?.high, name, 'high', warnings);
    const medium = normalizeTierConfig(profile?.medium, name, 'medium', warnings);
    const low = normalizeTierConfig(profile?.low, name, 'low', warnings);

    if (!high && !medium && !low) {
      warnings.push(
        `Profile "${name}" has no valid tiers. Skipped.`,
      );
      continue;
    }

    const classifierModel = normalizeClassifierConfig(
      (profile as Record<string, unknown>)?.classifierModel,
      warnings,
      `Profile "${name}" classifierModel`,
    );

    normalizedProfiles[name] = { high, medium, low, ...(classifierModel ? { classifierModel } : {}) };
  }

  const rules: RoutingRule[] = [];
  if (Array.isArray(raw.rules)) {
    for (const rule of raw.rules) {
      if (isObjectRecord(rule)) {
        const matches = rule.matches;
        const tier = rule.tier;
        if (
          (typeof matches === 'string' || Array.isArray(matches)) &&
          isRouterTier(tier)
        ) {
          rules.push({
            matches,
            tier,
            reason: typeof rule.reason === 'string' ? rule.reason : undefined,
          });
        } else {
          warnings.push(
            `Ignored invalid routing rule: ${JSON.stringify(rule)}`,
          );
        }
      }
    }
  }

  const classifierModel = normalizeClassifierConfig(
    raw.classifierModel as unknown,
    warnings,
    'classifierModel',
  );

  const vectorCache = normalizeVectorCacheConfig(
    (raw as unknown as Record<string, unknown>).vectorCache,
    warnings,
  );

  return {
    config: {
      debug: typeof raw.debug === 'boolean' ? raw.debug : false,
      classifierModel,
      rules: rules.length > 0 ? rules : undefined,
      profiles: normalizedProfiles,
      ...(vectorCache ? { vectorCache } : {}),
    },
    warnings,
  };
};

export const loadRouterConfig = (cwd: string): ConfigLoadResult => {
  const globalJsonPath = join(getAgentDir(), 'model-router.json');
  const globalJsoncPath = join(getAgentDir(), 'model-router.jsonc');
  const projectJsonPath = join(cwd, '.pi', 'model-router.json');
  const projectJsoncPath = join(cwd, '.pi', 'model-router.jsonc');
  const globalJsonResult = parseConfigFile(globalJsonPath);
  const globalJsoncResult = parseConfigFile(globalJsoncPath);
  const projectJsonResult = parseConfigFile(projectJsonPath);
  const projectJsoncResult = parseConfigFile(projectJsoncPath);
  const baseConfig: RouterConfig = { profiles: {} };
  // Priority: global .json < global .jsonc < project .json < project .jsonc
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

/**
 * Resolve the effective context window for a specific tier at runtime,
 * incorporating the API model registry as the highest-priority source.
 *
 * Resolution chain: API > tier config > model alias > hardcoded default
 */
export const resolveContextWindow = (
  tier: RouterTier,
  profile: RouterProfile,
  modelRegistry: ExtensionContext['modelRegistry'] | undefined,
): number => {
  const tierConfig = profile[tier];
  if (!tierConfig) return DEFAULT_CONTEXT_WINDOW;

  // 1. API value (highest priority)
  if (modelRegistry) {
    try {
      const { provider, modelId } = parseCanonicalModelRef(tierConfig.model);
      const registryModel = modelRegistry.find(provider, modelId);
      if (registryModel?.contextWindow) return registryModel.contextWindow;
    } catch { /* ignore */ }
  }

  // 2-4. Pre-resolved during config normalization (tier > alias > hardcoded)
  return tierConfig.resolvedContextWindow ?? DEFAULT_CONTEXT_WINDOW;
};

/**
 * Resolve the effective max tokens for a specific tier at runtime,
 * incorporating the API model registry as the highest-priority source.
 *
 * Resolution chain: API > tier config > model alias > hardcoded default
 */
export const resolveMaxTokens = (
  tier: RouterTier,
  profile: RouterProfile,
  modelRegistry: ExtensionContext['modelRegistry'] | undefined,
): number => {
  const tierConfig = profile[tier];
  if (!tierConfig) return DEFAULT_MAX_TOKENS;

  // 1. API value (highest priority)
  if (modelRegistry) {
    try {
      const { provider, modelId } = parseCanonicalModelRef(tierConfig.model);
      const registryModel = modelRegistry.find(provider, modelId);
      if (registryModel?.maxTokens) return registryModel.maxTokens;
    } catch { /* ignore */ }
  }

  // 2-4. Pre-resolved during config normalization (tier > alias > hardcoded)
  return tierConfig.resolvedMaxTokens ?? DEFAULT_MAX_TOKENS;
};



export const resolveDelegatedReasoning = (
  model: Model<Api>,
  requested: string | undefined,
): string | undefined => {
  if (!requested || !model.reasoning) return undefined;
  if (requested === 'off') return undefined;
  return requested;
};
