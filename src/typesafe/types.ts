import type { RouterTier } from "../types";

/** `state`는 구조를 유지해서 질문이 특정 필드를 가리킬 수 있게 함. */
export interface TypesafeState {
  message: string;
  history?: string;
}

export interface TypesafeChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface TypesafeRequest {
  state: TypesafeState;
  model: string;
  questions: Record<string, TypesafeChoiceQuestion>;
}

export interface TypesafeClassification {
  tier: RouterTier;
  confidence: number | undefined;
  probabilities: Record<string, number> | undefined;
}

export interface TypesafeClassificationResult extends TypesafeClassification {
  reasoning: string;
}

export type TypesafeOutcome<T> = { result: T } | { error: string };

/** 4xx는 재시도해도 결과가 같으므로 retryable=false. */
export type TypesafeCallOutcome = { body: unknown } | { error: string; retryable: boolean };
