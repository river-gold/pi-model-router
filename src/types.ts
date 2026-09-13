import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export type RouterTier = "max" | "xhigh" | "high" | "medium" | "low" | "minimal";

export interface ClassifierConfig {
  model: string;
  thinking?: ThinkingLevel;
}

/**
 * 분류기 후보를 다른 프로필에서 가져오는 논리적 참조.
 * - `"profile#tier"`: 해당 tier의 모델과 effort 사용.
 * - `"profile##effort"`: 해당 프로필의 low tier(없으면 가까운 tier) 모델에 effort 직접 지정.
 * - `"profile#tier##effort"`: 지정 tier 모델에 effort 직접 지정.
 * 라우팅 시점에 실시간 추적함.
 */
export interface ClassifierModelsRef {
  ref: string;
}

export interface RoutedTierConfig {
  /**
   * 논리적 참조. 있으면 models 대신 라우팅 시점에 실시간 추적함.
   * - `"profile#tier"`: 대상 tier의 모델과 effort 사용.
   * - `"profile##effort"`: 요청 tier를 따라가고 선택된 모델에 effort를 직접 지정.
   * - `"profile#tier##effort"`: 대상 tier의 모델에 effort를 직접 지정.
   */
  ref?: string;
  models?: string[];
  thinking?: ThinkingLevel; // 티어 기본값: `#` 없는 모델에 적용 (primary `#`가 있으면 우선)
  /** `thinking`의 별칭. 둘 다 있으면 `thinking` 우선. */
  effort?: ThinkingLevel;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  resolvedContextWindow?: number;
  resolvedMaxTokens?: number;
}

export interface RouterProfile {
  /** 프로필 기본 모델. 티어에 `models`가 없으면 상속됨 (명시된 티어 키에 한함). */
  models?: string[];
  max?: RoutedTierConfig;
  xhigh?: RoutedTierConfig;
  high?: RoutedTierConfig;
  medium?: RoutedTierConfig;
  low?: RoutedTierConfig;
  minimal?: RoutedTierConfig;
  classifierModels?: ClassifierConfig[] | ClassifierModelsRef;
}

export type TierGuides = Partial<Record<RouterTier, string>>;

export interface RouterConfig {
  debug?: boolean;
  classifierModels?: ClassifierConfig[] | ClassifierModelsRef;
  historySize?: number;
  tierGuides?: TierGuides;
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
