import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export type RouterTier = "max" | "xhigh" | "high" | "medium" | "low" | "minimal" | "off";

export interface RoutedTierConfig {
  models?: string[];
  /** tier 강제 effort: 이 tier의 직접 모델에만 적용하며 모델별 `#`보다 우선함. 위임 결과에는 전달되지 않음. */
  effort?: ThinkingLevel;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  resolvedContextWindow?: number;
  resolvedMaxTokens?: number;
}

export interface Router {
  random?: boolean;
  /** 라우터 기본 모델. 티어에 `models`가 없으면 상속됨 (명시된 티어 키에 한함). */
  models?: string[];
  max?: RoutedTierConfig;
  xhigh?: RoutedTierConfig;
  high?: RoutedTierConfig;
  medium?: RoutedTierConfig;
  low?: RoutedTierConfig;
  minimal?: RoutedTierConfig;
  off?: RoutedTierConfig;
}

export interface RouterConfig {
  debug?: boolean;
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
  isFallback?: boolean;
}

export interface ConfigLoadResult {
  config: RouterConfig;
  warnings: string[];
}

export interface ParsedConfigFile {
  config: Partial<RouterConfig>;
  warnings: string[];
}
