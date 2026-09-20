import type { Context } from "@earendil-works/pi-ai";
import type { TierGuides } from "../types";
import { getCurrentTurnProgressText, getHistoryPairs, getLastUserText } from "../context";
import { applyConfidenceGate } from "./confidence";
import { callTypesafe } from "./client";
import type { TypesafeFetch, TypesafeSleep } from "./client";
import {
  TYPESAFE_API_KEY_ENV,
  TYPESAFE_MAX_HISTORY_CHARS,
  TYPESAFE_MAX_HISTORY_PAIR_CHARS,
} from "./constants";
import { buildTypesafeRequest } from "./request";
import { parseTypesafeResponse } from "./response";
import type { TypesafeClassificationResult, TypesafeOutcome, TypesafeState } from "./types";

/** 뒤쪽(최신)을 남기고 max 길이로 자름. 자른 경우 앞에 …를 붙임. */
export const truncateTail = (text: string, max: number): string =>
  text.length <= max ? text : `…${text.slice(-(max - 1))}`;

/**
 * TypeSafe state.history를 Jev 토큰 한도 안에 들어가도록 자름.
 * pair별로 먼저 자르고(어떤 한 쌍이 전체를 독차지하지 않게), 다시 전체 길이를 제한함.
 */
export const buildTypesafeHistory = (context: Context, historySize: number): string | undefined => {
  const pairs = getHistoryPairs(context, historySize).map((pair) =>
    truncateTail(pair, TYPESAFE_MAX_HISTORY_PAIR_CHARS),
  );
  if (pairs.length === 0) return undefined;
  return truncateTail(pairs.join("\n---\n"), TYPESAFE_MAX_HISTORY_CHARS);
};

export const buildTypesafeState = (context: Context, historySize: number): TypesafeState => {
  const message = getLastUserText(context);
  // 툴 루프 중 재분류(routeEveryTurn)일 때만 존재: 이번 턴의 최신 assistant/tool 출력.
  const progress = getCurrentTurnProgressText(context);
  const base: TypesafeState = progress ? { message, progress } : { message };
  const history = buildTypesafeHistory(context, historySize);
  return history ? { ...base, history } : base;
};

export const classifyWithTypesafe = async (params: {
  context: Context;
  model: string;
  historySize: number;
  confidenceThreshold: number;
  tierGuides?: TierGuides;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
  fetchFn?: TypesafeFetch;
  sleepFn?: TypesafeSleep;
}): Promise<TypesafeOutcome<TypesafeClassificationResult>> => {
  const apiKey = (params.env ?? process.env)[TYPESAFE_API_KEY_ENV]?.trim();
  if (!apiKey) return { error: `${TYPESAFE_API_KEY_ENV} is not set.` };

  const call = await callTypesafe({
    request: buildTypesafeRequest(
      buildTypesafeState(params.context, params.historySize),
      params.model,
      params.tierGuides,
    ),
    apiKey,
    signal: params.signal,
    fetchFn: params.fetchFn,
    sleepFn: params.sleepFn,
  });
  if ("error" in call) return { error: call.error };

  const parsed = parseTypesafeResponse(call.body);
  if ("error" in parsed) return { error: parsed.error };

  const gate = applyConfidenceGate(parsed.result, params.confidenceThreshold);
  return {
    result: {
      tier: gate.tier,
      reasoning: gate.reasoning,
      confidence: parsed.result.confidence,
      probabilities: parsed.result.probabilities,
    },
  };
};
