import { describe, expect, it } from "vitest";
import { getLogPath, LOG_PATH } from "../../src/logger/constants";
import { homedir } from "node:os";
import { join } from "node:path";

describe("logger/constants 로그 경로 상수", () => {
  it("LOG_PATH는 homedir를 사용한다", () => {
    const expected = join(homedir(), ".pi", "logs", "pi-model-router.log");
    expect(LOG_PATH).toBe(expected);
  });

  it("getLogPath는 지정한 home 경로를 사용한다", () => {
    expect(getLogPath("/custom/home")).toBe(
      join("/custom/home", ".pi", "logs", "pi-model-router.log"),
    );
  });

  it("getLogPath 기본값은 LOG_PATH를 반환한다", () => {
    expect(getLogPath()).toBe(LOG_PATH);
  });
});
