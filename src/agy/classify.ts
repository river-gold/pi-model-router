/**
 * agy(Google Antigravity CLI) 기반 tier 분류 (`@@agy/<model>[:<effort>]` 체인 항목).
 * 프롬프트는 LLM 체인과 동일한 분류기 프롬프트를 쓰고, (model, effort)별로
 * 재사용되는 풀 프로세스로 실행하며, `--json-schema`로 tier를 구조화 출력 강제함.
 */
import type { Context } from "@earendil-works/pi-ai";
import type { RouterTier, TierGuides } from "../types";
import { OUTPUT_CONSTRAINT, buildClassifierPromptBody, parseClassifierOutput } from "../classifier";
import { buildClassifierSystemPrompt, isObjectRecord, isRouterTier, ROUTER_TIERS } from "../config";
import { buildAgySpawnArgs, loadAgyRunConfig } from "./config";
import { loadAgyMeta, resolveAgyModelArgs } from "./models";
import { AGY_ABORT_ERROR, AgyClassifierPool, type AgyTurnOutcome } from "./pool";

/** 분류 결과를 tier enum으로 강제하는 json-schema (agy `--json-schema`). */
export const AGY_TIER_JSON_SCHEMA = JSON.stringify({
  type: "object",
  properties: { tier: { type: "string", enum: [...ROUTER_TIERS] } },
  required: ["tier"],
  additionalProperties: false,
});

const TIER_WORD_PATTERN = new RegExp(`\\b(${ROUTER_TIERS.join("|")})\\b`, "gi");

const MAX_ERROR_OUTPUT_CHARS = 200;

const truncateOutput = (text: string): string =>
  text.length <= MAX_ERROR_OUTPUT_CHARS ? text : `${text.slice(0, MAX_ERROR_OUTPUT_CHARS)}…`;

/** LLM 체인과 동일한 분류기 프롬프트를 agy 턴 프롬프트로 합침. */
export const buildAgyClassifierPrompt = (
  context: Context,
  historySize: number,
  tierGuides?: TierGuides,
): string =>
  `${buildClassifierSystemPrompt(tierGuides)}\n\n${OUTPUT_CONSTRAINT}\n\n${buildClassifierPromptBody(
    context,
    historySize,
  )}`;

/**
 * 응답 전체가 tier 한 단어면 그대로 쓰고, 아니면(마크다운/설명 동반) tier 단어를 완전 일치로 스캔함.
 */
export const parseAgyClassifierTier = (fullText: string): RouterTier | undefined => {
  const exact = parseClassifierOutput(fullText);
  if (exact) return exact.tier;
  const matches = fullText.match(TIER_WORD_PATTERN);
  if (!matches || matches.length === 0) return undefined;
  const last = matches[matches.length - 1]!.toLowerCase();
  // 패턴이 ROUTER_TIERS로 만들어졌으므로 마지막 일치는 항상 tier 값임.
  return last as RouterTier;
};

/** json-schema 결과(`{"tier":"high"}`)를 우선 파싱하고, 실패 시 텍스트 스캔으로 폴백함. */
export const parseAgyClassifierResult = (fullText: string): RouterTier | undefined => {
  try {
    const parsed: unknown = JSON.parse(fullText.trim());
    if (isObjectRecord(parsed) && isRouterTier(parsed.tier)) return parsed.tier;
  } catch {
    // 구조화 출력이 아닌 경우: 텍스트 스캔으로 폴백
  }
  return parseAgyClassifierTier(fullText);
};

export type AgyClassificationResult = { tier: RouterTier; reasoning: string };

export type AgyOutcome = { result: AgyClassificationResult } | { error: string };

/** 풀은 프로세스 재사용이 목적이라 전역 1개만 씀 (설정이 바뀌면 args mismatch로 재spawn됨). */
let sharedPool: AgyClassifierPool | undefined;

export const getSharedAgyClassifierPool = (params: {
  idleMs: number;
  maxEntries: number;
}): AgyClassifierPool => {
  if (!sharedPool) sharedPool = new AgyClassifierPool(params.idleMs, params.maxEntries);
  return sharedPool;
};

export const classifyWithAgy = async (params: {
  context: Context;
  model: string;
  effort?: string;
  historySize: number;
  tierGuides?: TierGuides;
  signal?: AbortSignal;
  cwd: string;
  env?: Record<string, string | undefined>;
  cacheFile?: string;
  pool?: Pick<AgyClassifierPool, "run">;
}): Promise<AgyOutcome> => {
  const config = loadAgyRunConfig(params.env);
  const meta = await loadAgyMeta(params.cacheFile);
  const resolved = resolveAgyModelArgs(params.model, params.effort, meta?.[params.model]);
  if ("error" in resolved) return { error: resolved.error };

  const pool = params.pool ?? getSharedAgyClassifierPool(config);
  const run: AgyTurnOutcome = await pool.run({
    key: `${resolved.model}\u0000${resolved.effortArg ?? ""}`,
    binary: config.binary,
    args: buildAgySpawnArgs({
      cwd: params.cwd,
      extraArgs: config.extraArgs,
      model: resolved.model,
      effortArg: resolved.effortArg,
      jsonSchema: AGY_TIER_JSON_SCHEMA,
    }),
    prompt: buildAgyClassifierPrompt(params.context, params.historySize, params.tierGuides),
    cwd: params.cwd,
    timeoutMs: config.timeoutMs,
    signal: params.signal,
  });
  if ("error" in run) {
    return run.error === AGY_ABORT_ERROR
      ? { error: AGY_ABORT_ERROR }
      : { error: `agy classifier failed: ${run.error}` };
  }
  const tier = parseAgyClassifierResult(run.text);
  if (!tier) {
    return { error: `no tier in agy output: ${truncateOutput(run.text)}` };
  }
  return { result: { tier, reasoning: "Classifier decision." } };
};
