import { describe, expect, it, vi } from "vitest";
import {
  agyCachePath,
  loadAgyMeta,
  resolveAgyModelArgs,
  type AgyModelMeta,
} from "../../src/agy/models";

const readFileOk = (content: string) => async () => content;
describe("loadAgyMeta 모델 캐시 로딩을 검증함", () => {
  it("pi-agent-bridge 캐시 경로를 홈 기준으로 계산함을 검증함", () => {
    expect(agyCachePath()).toContain(".cache/pi-agent-bridge/models.json");
  });

  it("캐시 JSON을 모델 메타 맵으로 변환함을 검증함", async () => {
    const meta = await loadAgyMeta(
      "/cache",
      readFileOk(
        JSON.stringify({
          binary: "agy",
          models: {
            "gemini-3.7-flash": {
              name: "Gemini 3.7 Flash",
              variants: ["high", "medium", "low"],
              defaultVariant: "high",
            },
            "gpt-oss-120b-medium": { name: "GPT-OSS 120B (Medium)" },
          },
        }),
      ),
    );
    expect(meta).toEqual({
      "gemini-3.7-flash": { variants: ["high", "medium", "low"], defaultVariant: "high" },
      "gpt-oss-120b-medium": { variants: [], defaultVariant: undefined },
    });
  });

  it("잘못된 variants 항목은 문자열만 남김을 검증함", async () => {
    const meta = await loadAgyMeta(
      "/cache",
      readFileOk(JSON.stringify({ models: { m: { variants: ["high", 1, null] } } })),
    );
    expect(meta).toEqual({ m: { variants: ["high"], defaultVariant: undefined } });
  });

  it("객체가 아닌 모델 항목은 건너뛀을 검증함", async () => {
    const meta = await loadAgyMeta(
      "/cache",
      readFileOk(JSON.stringify({ models: { m: "x", ok: { variants: ["low"] } } })),
    );
    expect(meta).toEqual({ ok: { variants: ["low"], defaultVariant: undefined } });
  });

  it("파일이 없거나 깨졌으면 undefined를 반환함을 검증함", async () => {
    await expect(loadAgyMeta("/missing", readFileOk)).resolves.toBeUndefined();
    await expect(loadAgyMeta("/broken", readFileOk("not json"))).resolves.toBeUndefined();
  });

  it("models가 없는 구조는 undefined를 반환함을 검증함", async () => {
    await expect(loadAgyMeta("/x", readFileOk('{"binary":"agy"}'))).resolves.toBeUndefined();
    await expect(loadAgyMeta("/x", readFileOk('"str"'))).resolves.toBeUndefined();
  });

  it("readFile 실패 시 undefined를 반환함을 검증함", async () => {
    const readFileFn = vi.fn(async () => {
      throw new Error("eacces");
    });
    await expect(loadAgyMeta("/x", readFileFn)).resolves.toBeUndefined();
  });
});

describe("resolveAgyModelArgs variant 해석을 검증함", () => {
  const meta: AgyModelMeta = { variants: ["high", "medium", "low"], defaultVariant: "high" };

  it("메타 없이 effort가 있으면 --effort 플래그로 전달함을 검증함", () => {
    expect(resolveAgyModelArgs("gemini-3.7-flash", "high", undefined)).toEqual({
      model: "gemini-3.7-flash",
      effortArg: "high",
    });
    expect(resolveAgyModelArgs("gemini-3.7-flash", undefined, undefined)).toEqual({
      model: "gemini-3.7-flash",
    });
  });

  it("effort 미지정 시 기본 variant를 붙임을 검증함", () => {
    expect(resolveAgyModelArgs("gemini-3.7-flash", undefined, meta)).toEqual({
      model: "gemini-3.7-flash-high",
    });
    expect(resolveAgyModelArgs("m", undefined, { variants: [], defaultVariant: "low" })).toEqual({
      model: "m-low",
    });
    expect(resolveAgyModelArgs("m", undefined, { variants: [] })).toEqual({ model: "m" });
  });

  it("effort가 variant 목록에 있으면 붙임을 검증함", () => {
    expect(resolveAgyModelArgs("gemini-3.7-flash", "low", meta)).toEqual({
      model: "gemini-3.7-flash-low",
    });
  });

  it("effort를 variant에서 못 찾으면 error를 반환함을 검증함", () => {
    expect(resolveAgyModelArgs("gemini-3.7-flash", "xhigh", meta)).toEqual({
      error: 'agy model "gemini-3.7-flash" has no variant "xhigh" (variants: high, medium, low)',
    });
    expect(resolveAgyModelArgs("m", "high", { variants: [] })).toEqual({
      error: 'agy model "m" has no variants; drop the ":high" suffix',
    });
  });
});
