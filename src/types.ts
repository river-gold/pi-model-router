import type { ThinkingLevel } from '@earendil-works/pi-agent-core';

export type RouterTier = 'max' | 'xhigh' | 'high' | 'medium' | 'low' | 'minimal';

export interface ClassifierConfig {
  model: string;
  thinking?: ThinkingLevel;
}

export interface RoutedTierConfig {
  models?: string[];
  model?: string; // primary (models[0] normalized without #thinking)
  thinking?: ThinkingLevel; // thinking of primary (default medium)
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  resolvedContextWindow?: number;
  resolvedMaxTokens?: number;
}

export interface RouterProfile {
  max?: RoutedTierConfig;
  xhigh?: RoutedTierConfig;
  high?: RoutedTierConfig;
  medium?: RoutedTierConfig;
  low?: RoutedTierConfig;
  minimal?: RoutedTierConfig;
  classifierModels?: ClassifierConfig[];
}

export interface RouterConfig {
  debug?: boolean;
  classifierModels?: ClassifierConfig[];
  classifierModel?: ClassifierConfig; // deprecated alias
  historySize?: number;
  profiles: Record<string, RouterProfile>;
}

export interface RoutingDecision {
  profile: string;
  tier: RouterTier;
  targetProvider: string;
  targetModelId: string;
  targetLabel: string;
  reasoning: string;
  thinking?: ThinkingLevel;
  timestamp: number;
  isClassifier?: boolean;
  isFallback?: boolean;
}

export interface RouterPersistedState {
  enabled: boolean;
  selectedProfile: string;
  debugEnabled?: boolean;
  debugHistory?: RoutingDecision[];
  lastDecision?: RoutingDecision;
  lastNonRouterModel?: string;
  accumulatedCost?: number;
  timestamp: number;
}

export interface ConfigLoadResult {
  config: RouterConfig;
  warnings: string[];
}

export interface ParsedConfigFile {
  config: Partial<RouterConfig>;
  warnings: string[];
}

export interface CustomSessionEntry {
  type: string;
  customType?: string;
  data?: unknown;
}


