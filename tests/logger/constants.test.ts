import { describe, expect, it } from "vitest";
import { getLogPath, LOG_PATH } from "../../src/logger/constants";
import { homedir } from "node:os";
import { join } from "node:path";

describe("logger/constants", () => {
  it("LOG_PATH uses homedir", () => {
    const expected = join(homedir(), ".pi", "logs", "pi-model-router.log");
    expect(LOG_PATH).toBe(expected);
  });

  it("getLogPath with custom home", () => {
    expect(getLogPath("/custom/home")).toBe(
      join("/custom/home", ".pi", "logs", "pi-model-router.log"),
    );
  });

  it("getLogPath default", () => {
    expect(getLogPath()).toBe(LOG_PATH);
  });
});
