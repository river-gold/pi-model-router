import type { Context } from "@earendil-works/pi-ai";
import type { TierGuides } from "../types";
import { getHistoryPairsText, getLastUserText } from "../context";
import { applyConfidenceGate } from "./confidence";
import { callTypesafe } from "./client";
import type { TypesafeFetch, TypesafeSleep } from "./client";
import { TYPESAFE_API_KEY_ENV } from "./constants";
import { buildTypesafeRequest } from "./request";
import { parseTypesafeResponse } from "./response";
import type { TypesafeClassificationResult, TypesafeOutcome, TypesafeState } from "./types";

export const buildTypesafeState = (context: Context, historySize: number): TypesafeState => {
  const message = getLastUserText(context);
  if (historySize <= 0) return { message };
  const history = getHistoryPairsText(context, historySize);
  return history ? { message, history } : { message };
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
