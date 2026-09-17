import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export type RouterTier = "max" | "xhigh" | "high" | "medium" | "low" | "minimal";

export interface ClassifierConfig {
  model: string;
  thinking?: ThinkingLevel;
}

/**
 * `"@@typesafe/<model>"` 항목을 정규화한 형태.
 * 로컬 LLM 모델 대신 TypeSafe System One API를 분류기로 씀. `<model>`은 API에 그대로 전달됨.
 */
export interface TypesafeClassifierConfig {
  typesafe: true;
  model: string;
}

/**
 * `"@profile#tier"` / `"@profile##effort"` / `"@profile#tier##effort"` 항목을 정규화한 형태.
 * 라우팅 시점에 해당 profile/tier 모델로 실시간 확장됨.
 */
export interface ClassifierRefConfig {
  ref: string;
}

/** classifierModels 배열의 한 항목. */
export type ClassifierSettingEntry =
  | ClassifierConfig
  | ClassifierRefConfig
  | TypesafeClassifierConfig;

/** classifierModels에 허용되는 설정 전체 (정규화 후에는 항상 배열). */
export type ClassifierModelsSetting = ClassifierSettingEntry[];

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
  classifierModels?: ClassifierModelsSetting;
}

export type TierGuides = Partial<Record<RouterTier, string>>;

export interface RouterConfig {
  debug?: boolean;
  /**
   * 분류기 후보 체인 (선언 순서대로 시도하고, 실패하면 다음 항목으로 폴백함).
   * - `"provider/model#thinking"`: 로컬 LLM 분류기
   * - `"@profile#tier"`: 다른 profile/tier 모델을 라우팅 시점에 실시간 참조
   * - `"@@typesafe/<model>"`: TypeSafe System One API
   */
  classifierModels?: ClassifierModelsSetting;
  /** TypeSafe Choice confidence 임계값 (0~1). 이 값보다 낮으면 한 단계 위 tier로 승격함. 기본 0.5. */
  typesafeConfidenceThreshold?: number;
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
