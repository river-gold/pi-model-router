import { describe, it, expect } from "vitest";
import {
  isOpencodeTarget,
  getOpencodeSessionHeaders,
  mergeDelegatedHeaders,
  matchesOpencodeHost,
} from "../../src/provider/attribution";

describe("matchesOpencodeHost 함수는", () => {
  it("opencode.ai 호스트이면 true를 반환한다", () => {
    expect(matchesOpencodeHost("https://opencode.ai/zen/go/v1")).toBe(true);
  });
  it("다른 호스트이면 false를 반환한다", () => {
    expect(matchesOpencodeHost("https://openrouter.ai/api/v1")).toBe(false);
  });
  it("없거나 파싱 불가한 baseUrl이면 false를 반환한다", () => {
    expect(matchesOpencodeHost(undefined)).toBe(false);
    expect(matchesOpencodeHost("::not-a-url::")).toBe(false);
  });
});

describe("isOpencodeTarget 함수는", () => {
  it("opencode/opencode-go provider를 판별한다", () => {
    expect(isOpencodeTarget({ provider: "opencode-go", baseUrl: "https://x" })).toBe(true);
    expect(isOpencodeTarget({ provider: "opencode", baseUrl: "https://x" })).toBe(true);
    expect(isOpencodeTarget({ provider: "openai", baseUrl: "https://api.openai.com" })).toBe(
      false,
    );
  });
  it("provider가 달라도 opencode.ai 호스트이면 true를 반환한다", () => {
    expect(isOpencodeTarget({ provider: "custom", baseUrl: "https://opencode.ai/zen" })).toBe(true);
  });
});

describe("getOpencodeSessionHeaders 함수는", () => {
  it("opencode 타깃과 sessionId가 있으면 세션 헤더를 반환한다", () => {
    expect(
      getOpencodeSessionHeaders({ provider: "opencode-go", baseUrl: "https://opencode.ai" }, "s1"),
    ).toEqual({ "x-opencode-session": "s1", "x-opencode-client": "pi" });
  });
  it("sessionId가 없으면 undefined를 반환한다", () => {
    expect(
      getOpencodeSessionHeaders({ provider: "opencode-go", baseUrl: "https://opencode.ai" }, undefined),
    ).toBeUndefined();
  });
  it("opencode 타깃이 아니면 undefined를 반환한다", () => {
    expect(getOpencodeSessionHeaders({ provider: "openai", baseUrl: "https://x" }, "s1")).toBeUndefined();
  });
});

describe("mergeDelegatedHeaders 함수는", () => {
  it("모두 없으면 undefined를 반환한다", () => {
    expect(
      mergeDelegatedHeaders({ provider: "openai" }, undefined, undefined, undefined),
    ).toBeUndefined();
  });
  it("opencode 타깃이면 세션 헤더를 기본값으로 포함한다", () => {
    expect(
      mergeDelegatedHeaders(
        { provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1" },
        "sess",
        undefined,
        { Authorization: "Bearer k" },
      ),
    ).toEqual({
      "x-opencode-session": "sess",
      "x-opencode-client": "pi",
      Authorization: "Bearer k",
    });
  });
  it("명시적 호출자 헤더가 세션 기본값을 덮어쓴다", () => {
    expect(
      mergeDelegatedHeaders(
        { provider: "opencode-go", baseUrl: "https://opencode.ai" },
        "sess",
        { "x-opencode-session": "explicit" },
        undefined,
      ),
    ).toEqual({ "x-opencode-session": "explicit", "x-opencode-client": "pi" });
  });
  it("opencode 타깃이 아니면 세션 헤더를 추가하지 않는다", () => {
    expect(
      mergeDelegatedHeaders({ provider: "openai" }, "sess", { "x-a": "1" }, { "x-b": "2" }),
    ).toEqual({ "x-a": "1", "x-b": "2" });
  });
});
