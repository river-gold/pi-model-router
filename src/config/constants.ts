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

/** classifierModels에 이 문자열을 쓰면 TypeSafe System One 분류기를 씀. */
export const TYPESAFE_CLASSIFIER_REF = "TYPESAFE_CLASSIFIER";
