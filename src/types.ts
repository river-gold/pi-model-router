import type { ThinkingLevel } from '@earendil-works/pi-agent-core';

export type RouterTier = 'high' | 'medium' | 'low';

export interface ClassifierConfig {
  model: string;
  thinking?: ThinkingLevel;
}

export interface RoutedTierConfig {
  model: string;
  thinking?: ThinkingLevel;
  fallbacks?: string[];
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  resolvedContextWindow?: number;
  resolvedMaxTokens?: number;
}

export interface RouterProfile {
  high?: RoutedTierConfig;
  medium?: RoutedTierConfig;
  low?: RoutedTierConfig;
  classifierModel?: ClassifierConfig;
}

export interface RouterConfig {
  debug?: boolean;
  classifierModel?: ClassifierConfig;
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
  thinking: ThinkingLevel;
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


