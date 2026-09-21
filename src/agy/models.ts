/**
 * agy 모델 variant 해석 (pi-agent-bridge의 resolveAgyModelId 계약을 따름).
 *
 * 모델 카탈로그는 pi-agent-bridge가 `agy models`로 저장한 캐시를 참고함:
 *   ~/.cache/pi-agent-bridge/models.json
 * 캐시가 없으면 모델 id를 그대로 쓰고, effort가 있으면 `--effort` 플래그로 전달함.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isObjectRecord } from "../config";

/** pi-agent-bridge 모델 캐시에서 가져온 모델 메타. */
export interface AgyModelMeta {
  variants: string[];
  defaultVariant?: string;
}

export const AGY_CACHE_DIR = ".cache/pi-agent-bridge";

export const agyCachePath = (): string => join(homedir(), AGY_CACHE_DIR, "models.json");

/** 캐시 파일을 읽어 모델 메타 맵으로 변환함. 없거나 깨진 파일은 undefined (variant 강제 해석 생략). */
export const loadAgyMeta = async (
  cacheFile: string = agyCachePath(),
  readFileFn: typeof readFile = readFile,
): Promise<Record<string, AgyModelMeta> | undefined> => {
  let raw: string;
  try {
    raw = await readFileFn(cacheFile, "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isObjectRecord(parsed) || !isObjectRecord(parsed.models)) return undefined;
  const out: Record<string, AgyModelMeta> = {};
  for (const [id, value] of Object.entries(parsed.models)) {
    if (!isObjectRecord(value)) continue;
    const variants = Array.isArray(value.variants)
      ? value.variants.filter((v): v is string => typeof v === "string")
      : [];
    const defaultVariant =
      typeof value.defaultVariant === "string" ? value.defaultVariant : undefined;
    out[id] = { variants, defaultVariant };
  }
  return out;
};

export type AgyModelArgs = { model: string; effortArg?: string } | { error: string };

/**
 * `@@agy/<model>[:<effort>]`를 agy CLI 인자로 해석함.
 * - 메타 있음 + effort가 variant 목록에 있음 → `--model <model>-<effort>` (브리지와 동일)
 * - 메타 있음 + effort 미지정 → 기본 variant를 붙임 (없으면 그대로)
 * - 메타 있음 + effort를 variant에서 못 찾음 → error (체인의 다음 항목으로 폴백)
 * - 메타 없음(캐시 부재) → 모델 id 그대로, effort는 `--effort` 플래그로 전달
 */
export const resolveAgyModelArgs = (
  model: string,
  effort: string | undefined,
  meta: AgyModelMeta | undefined,
): AgyModelArgs => {
  if (!meta) {
    if (!effort) return { model };
    return { model, effortArg: effort };
  }
  if (!effort) {
    const defaultVariant = meta.defaultVariant ?? meta.variants[0];
    return defaultVariant ? { model: `${model}-${defaultVariant}` } : { model };
  }
  if (meta.variants.length > 0 && !meta.variants.includes(effort)) {
    return {
      error: `agy model "${model}" has no variant "${effort}" (variants: ${meta.variants.join(", ")})`,
    };
  }
  if (meta.variants.length === 0) {
    return {
      error: `agy model "${model}" has no variants; drop the ":${effort}" suffix`,
    };
  }
  return { model: `${model}-${effort}` };
};
