import { describe, expect, it } from "vitest";
import {
  AGY_BINARY_ENV,
  AGY_EXTRA_ARGS_ENV,
  AGY_IDLE_MS_ENV,
  AGY_MAX_ENTRIES_ENV,
  AGY_TIMEOUT_MS_ENV,
  DEFAULT_AGY_IDLE_MS,
  DEFAULT_AGY_MAX_ENTRIES,
  DEFAULT_AGY_TIMEOUT_MS,
  buildAgySpawnArgs,
  loadAgyRunConfig,
} from "../../src/agy/config";
import { AGY_TIER_JSON_SCHEMA } from "../../src/agy/classify";

describe("loadAgyRunConfig 환경설정 로딩을 검증함", () => {
  it("기본값을 반환함을 검증함", () => {
    expect(loadAgyRunConfig({})).toEqual({
      binary: "agy",
      extraArgs: [],
      timeoutMs: DEFAULT_AGY_TIMEOUT_MS,
      idleMs: DEFAULT_AGY_IDLE_MS,
      maxEntries: DEFAULT_AGY_MAX_ENTRIES,
    });
  });

  it("AGY_BINARY/AGY_EXTRA_ARGS를 적용함을 검증함", () => {
    expect(
      loadAgyRunConfig({
        [AGY_BINARY_ENV]: " /opt/agy ",
        [AGY_EXTRA_ARGS_ENV]: "  --flag-a --flag-b ",
      }),
    ).toEqual(expect.objectContaining({ binary: "/opt/agy", extraArgs: ["--flag-a", "--flag-b"] }));
  });

  it("타임아웃·풀링 시간·풀 크기를 환경변수로 설정함을 검증함", () => {
    expect(
      loadAgyRunConfig({
        [AGY_TIMEOUT_MS_ENV]: "5000",
        [AGY_IDLE_MS_ENV]: "60000",
        [AGY_MAX_ENTRIES_ENV]: "4",
      }),
    ).toEqual(expect.objectContaining({ timeoutMs: 5000, idleMs: 60_000, maxEntries: 4 }));
  });

  it("잘못된 수치는 기본값으로 폴백함을 검증함", () => {
    expect(
      loadAgyRunConfig({
        [AGY_TIMEOUT_MS_ENV]: "abc",
        [AGY_IDLE_MS_ENV]: "-1",
        [AGY_MAX_ENTRIES_ENV]: "1500.7",
      }),
    ).toEqual({
      binary: "agy",
      extraArgs: [],
      timeoutMs: DEFAULT_AGY_TIMEOUT_MS,
      idleMs: DEFAULT_AGY_IDLE_MS,
      maxEntries: 1500,
    });
  });
});

describe("buildAgySpawnArgs spawn 인자 구성을 검증함", () => {
  it("브리지 spawn 계약과 동일한 인자를 만듦을 검증함", () => {
    expect(
      buildAgySpawnArgs({
        cwd: "/cwd",
        extraArgs: [],
        model: "gemini-3.7-flash-high",
        jsonSchema: AGY_TIER_JSON_SCHEMA,
      }),
    ).toEqual([
      "--add-dir",
      "/cwd",
      "--model",
      "gemini-3.7-flash-high",
      "--json-schema",
      AGY_TIER_JSON_SCHEMA,
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
    ]);
  });

  it("effort 플래그와 extraArgs를 포함함을 검증함", () => {
    expect(
      buildAgySpawnArgs({
        cwd: "/cwd",
        extraArgs: ["--flag-a"],
        model: "m",
        effortArg: "high",
      }),
    ).toEqual([
      "--add-dir",
      "/cwd",
      "--flag-a",
      "--model",
      "m",
      "--effort",
      "high",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
    ]);
  });
});
