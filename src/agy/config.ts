/**
 * agy CLI 실행 설정 (pi-agent-bridge의 env 계약을 따름).
 *
 * | Env                       | 기본값   | 의미                                    |
 * |---------------------------|----------|-----------------------------------------|
 * | AGY_BINARY                | agy      | CLI 바이너리                            |
 * | AGY_TIMEOUT_MS            | 300000   | 분류 1턴 타임아웃(ms)                   |
 * | AGY_CLASSIFIER_IDLE_MS    | 1800000  | 분류기 풀 idle 축출 시간(ms, 기본 30분) |
 * | AGY_CLASSIFIER_MAX_ENTRIES| 20       | 분류기 풀 최대 프로세스 수              |
 * | AGY_EXTRA_ARGS            | (없음)   | 추가 인자, 공백 구분                    |
 */
export const AGY_BINARY_ENV = "AGY_BINARY";
export const AGY_TIMEOUT_MS_ENV = "AGY_TIMEOUT_MS";
export const AGY_IDLE_MS_ENV = "AGY_CLASSIFIER_IDLE_MS";
export const AGY_MAX_ENTRIES_ENV = "AGY_CLASSIFIER_MAX_ENTRIES";
export const AGY_EXTRA_ARGS_ENV = "AGY_EXTRA_ARGS";
export const DEFAULT_AGY_TIMEOUT_MS = 300_000;
/** 분류기 풀 idle 축출 기본값: 30분. */
export const DEFAULT_AGY_IDLE_MS = 30 * 60 * 1000;
export const DEFAULT_AGY_MAX_ENTRIES = 20;

export interface AgyRunConfig {
  binary: string;
  extraArgs: string[];
  timeoutMs: number;
  idleMs: number;
  maxEntries: number;
}

const envPositiveInt = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw?.trim());
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

export const loadAgyRunConfig = (
  env: Record<string, string | undefined> = process.env,
): AgyRunConfig => {
  const binary = env[AGY_BINARY_ENV]?.trim() || "agy";
  const extraArgs = (env[AGY_EXTRA_ARGS_ENV]?.trim() ?? "")
    .split(/\s+/)
    .filter((arg) => arg.length > 0);
  return {
    binary,
    extraArgs,
    timeoutMs: envPositiveInt(env[AGY_TIMEOUT_MS_ENV], DEFAULT_AGY_TIMEOUT_MS),
    idleMs: envPositiveInt(env[AGY_IDLE_MS_ENV], DEFAULT_AGY_IDLE_MS),
    maxEntries: envPositiveInt(env[AGY_MAX_ENTRIES_ENV], DEFAULT_AGY_MAX_ENTRIES),
  };
};

/** 분류 spawn 인자 (브리지 spawn 계약 + tier 구조화 출력용 json-schema). */
export const buildAgySpawnArgs = (params: {
  cwd: string;
  extraArgs: string[];
  model: string;
  effortArg?: string;
  jsonSchema?: string;
}): string[] => [
  "--add-dir",
  params.cwd,
  ...params.extraArgs,
  "--model",
  params.model,
  ...(params.effortArg ? ["--effort", params.effortArg] : []),
  ...(params.jsonSchema ? ["--json-schema", params.jsonSchema] : []),
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
];
