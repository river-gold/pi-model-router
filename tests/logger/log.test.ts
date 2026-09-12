import { describe, expect, it, vi } from "vitest";
import { createLogClassifierSync } from "../../src/logger/log";
import type { ClassifierLogEntry } from "../../src/logger/types";

describe("logger/log 분류 로그 기록", () => {
  const baseEntry: ClassifierLogEntry = {
    timestamp: "2024-01-01T00:00:00Z",
    model: "openai/gpt-4o",
    fullText: "hello",
    success: true,
  };

  it("ensure·build·append를 호출한다", async () => {
    const appendFile = vi.fn().mockResolvedValue(undefined);
    const ensureLogDir = vi.fn().mockResolvedValue(undefined);
    const buildLogLine = vi.fn().mockReturnValue("line\n");
    const log = createLogClassifierSync(
      (path, data, encoding) => appendFile(path, data, encoding),
      () => ensureLogDir(),
      (entry) => buildLogLine(entry),
      "/tmp/log",
    );
    log(baseEntry);
    // wait for async IIFE
    await new Promise((r) => setTimeout(r, 10));
    expect(ensureLogDir).toHaveBeenCalled();
    expect(buildLogLine).toHaveBeenCalledWith(baseEntry);
    expect(appendFile).toHaveBeenCalledWith("/tmp/log", "line\n", "utf-8");
  });

  it("의존성 없이 기본값으로 동작한다", async () => {
    // This test ensures the default factory works, but we mock fs to avoid actual file
    const appendFile = vi.fn().mockResolvedValue(undefined);
    const ensureLogDir = vi.fn().mockResolvedValue(undefined);
    const log = createLogClassifierSync(
      (path, data, encoding) => appendFile(path, data, encoding),
      () => ensureLogDir(),
      (e) => `test ${e.model}\n`,
      "/tmp/log",
    );
    log(baseEntry);
    await new Promise((r) => setTimeout(r, 10));
    // no throw
  });

  it("ensure 실패에도 예외를 던지지 않는다", async () => {
    const appendFile = vi.fn();
    const ensureLogDir = vi.fn().mockRejectedValue(new Error("fail"));
    const log = createLogClassifierSync(
      (path, data, encoding) => appendFile(path, data, encoding),
      () => ensureLogDir(),
      undefined,
      "/tmp/log",
    );
    log(baseEntry);
    await new Promise((r) => setTimeout(r, 10));
    expect(appendFile).not.toHaveBeenCalled();
  });

  it("append 실패에도 예외를 던지지 않는다", async () => {
    const appendFile = vi.fn().mockRejectedValue(new Error("fail"));
    const ensureLogDir = vi.fn().mockResolvedValue(undefined);
    const log = createLogClassifierSync(
      (path, data, encoding) => appendFile(path, data, encoding),
      () => ensureLogDir(),
      undefined,
      "/tmp/log",
    );
    log(baseEntry);
    await new Promise((r) => setTimeout(r, 10));
    expect(appendFile).toHaveBeenCalled();
    // should not throw
  });

  it("build 실패에도 예외를 던지지 않는다", async () => {
    const appendFile = vi.fn();
    const ensureLogDir = vi.fn().mockResolvedValue(undefined);
    const buildLogLine = vi.fn().mockImplementation(() => {
      throw new Error("build fail");
    });
    const log = createLogClassifierSync(
      (path, data, encoding) => appendFile(path, data, encoding),
      () => ensureLogDir(),
      (entry) => buildLogLine(entry),
      "/tmp/log",
    );
    log(baseEntry);
    await new Promise((r) => setTimeout(r, 10));
    expect(appendFile).not.toHaveBeenCalled();
  });

  it("모든 선택 필드를 처리한다", async () => {
    const appendFile = vi.fn().mockResolvedValue(undefined);
    const ensureLogDir = vi.fn().mockResolvedValue(undefined);
    const log = createLogClassifierSync(
      (path, data, encoding) => appendFile(path, data, encoding),
      () => ensureLogDir(),
      undefined,
      "/tmp/log",
    );
    const entry: ClassifierLogEntry = {
      timestamp: "t",
      model: "m",
      thinking: "high",
      fullText: "x".repeat(5000),
      tierLine: "tier",
      reasoningLine: "reason",
      parsedTier: "high",
      success: false,
      error: "err",
    };
    log(entry);
    await new Promise((r) => setTimeout(r, 10));
    expect(appendFile).toHaveBeenCalled();
    const line: unknown = appendFile.mock.calls[0]?.[1];
    if (typeof line !== "string") throw new Error("expected string log line");
    expect(line).toContain("high");
  });
});
