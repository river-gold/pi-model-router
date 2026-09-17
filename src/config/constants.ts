export const ROUTER_TIERS = ["max", "xhigh", "high", "medium", "low", "minimal"] as const;

export const DEFAULT_HISTORY_SIZE = 0;

export const ALLOWED_THINKING = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export const MAX_HISTORY_SIZE = 20;

/** classifierModels 항목 앞에 붙이면 다른 router/tier 모델을 라우팅 시점에 실시간 참조함. */
export const CLASSIFIER_REF_PREFIX = "@";

/** classifierModels 항목의 TypeSafe System One 접두사 (`"@@typesafe/<model>"`). */
export const TYPESAFE_ENTRY_PREFIX = "@@typesafe/";
