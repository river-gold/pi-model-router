import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export type RouterTier = "max" | "xhigh" | "high" | "medium" | "low" | "minimal";

export interface ClassifierConfig {
  model: string;
  effort?: ThinkingLevel;
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
 * `"@router"` / `"@router#tier"` / `"@router#tier#effort"` 항목을 정규화한 형태.
 * 라우팅 시점에 해당 router/tier 모델로 실시간 확장됨. tier 생략 시 기본 티어(medium).
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
  models?: string[];
  /** tier 강제 effort: 이 tier로 선택되면 모델별 `#`와 위임 결과보다 우선 적용됨. */
  effort?: ThinkingLevel;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  resolvedContextWindow?: number;
  resolvedMaxTokens?: number;
}

export interface Router {
  /** 라우터 기본 모델. 티어에 `models`가 없으면 상속됨 (명시된 티어 키에 한함). */
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
   * - `"provider/model#effort"`: 로컬 LLM 분류기
   * - `"@router"` / `"@router#tier"`: 다른 router/tier 모델을 라우팅 시점에 실시간 참조 (tier 생략 시 medium)
   * - `"@@typesafe/<model>"`: TypeSafe System One API
   */
  classifierModels?: ClassifierModelsSetting;
  /** TypeSafe Choice confidence 임계값 (0~1). 이 값보다 낮으면 한 단계 위 tier로 승격함. 기본 0.5. */
  typesafeConfidenceThreshold?: number;
  historySize?: number;
  tierGuides?: TierGuides;
  routers: Record<string, Router>;
}

export interface RoutingDecision {
  router: string;
  tier: RouterTier;
  targetProvider: string;
  targetModelId: string;
  targetLabel: string;
  reasoning: string;
  /** 이 결정으로 적용할 effort (pi thinking level). 미지정 시 모델 기본값을 따름. */
  effort?: ThinkingLevel;
  timestamp: number;
  isClassifier?: boolean;
  isFallback?: boolean;
}

export interface RouterPersistedState {
  enabled: boolean;
  selectedRouter: string;
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
