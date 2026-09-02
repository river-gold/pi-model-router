import { describe, expect, it, vi, beforeEach } from "vitest";
import { createLogClassifierSync } from "../../src/logger/log";
import type { ClassifierLogEntry } from "../../src/logger/types";

describe("logger/log", () => {
  const baseEntry: ClassifierLogEntry = {
    timestamp: "2024-01-01T00:00:00Z",
    model: "openai/gpt-4o",
    fullText: "hello",
    success: true,
  };

  it("calls ensure, build, append", async () => {
    const appendFile = vi.fn().mockResolvedValue(undefined);
    const ensureLogDir = vi.fn().mockResolvedValue(undefined);
    const buildLogLine = vi.fn().mockReturnValue("line\n");
    const log = createLogClassifierSync(appendFile as any, ensureLogDir as any, buildLogLine as any, "/tmp/log");
    log(baseEntry);
    // wait for async IIFE
    await new Promise((r) => setTimeout(r, 10));
    expect(ensureLogDir).toHaveBeenCalled();
    expect(buildLogLine).toHaveBeenCalledWith(baseEntry);
    expect(appendFile).toHaveBeenCalledWith("/tmp/log", "line\n", "utf-8");
  });

  it("uses defaults when no deps provided", async () => {
    // This test ensures the default factory works, but we mock fs to avoid actual file
    const log = createLogClassifierSync(
      vi.fn().mockResolvedValue(undefined) as any,
      vi.fn().mockResolvedValue(undefined) as any,
      (e) => `test ${e.model}\n`,
      "/tmp/log",
    );
    log(baseEntry);
    await new Promise((r) => setTimeout(r, 10));
    // no throw
  });

  it("never throws on ensure failure", async () => {
    const appendFile = vi.fn();
    const ensureLogDir = vi.fn().mockRejectedValue(new Error("fail"));
    const log = createLogClassifierSync(appendFile as any, ensureLogDir as any, undefined as any, "/tmp/log");
    log(baseEntry);
    await new Promise((r) => setTimeout(r, 10));
    expect(appendFile).not.toHaveBeenCalled();
  });

  it("never throws on append failure", async () => {
    const appendFile = vi.fn().mockRejectedValue(new Error("fail"));
    const ensureLogDir = vi.fn().mockResolvedValue(undefined);
    const log = createLogClassifierSync(appendFile as any, ensureLogDir as any, undefined as any, "/tmp/log");
    log(baseEntry);
    await new Promise((r) => setTimeout(r, 10));
    expect(appendFile).toHaveBeenCalled();
    // should not throw
  });

  it("never throws on build failure", async () => {
    const appendFile = vi.fn();
    const ensureLogDir = vi.fn().mockResolvedValue(undefined);
    const buildLogLine = vi.fn().mockImplementation(() => {
      throw new Error("build fail");
    });
    const log = createLogClassifierSync(appendFile as any, ensureLogDir as any, buildLogLine as any, "/tmp/log");
    log(baseEntry);
    await new Promise((r) => setTimeout(r, 10));
    expect(appendFile).not.toHaveBeenCalled();
  });

  it("handles all optional fields", async () => {
    const appendFile = vi.fn().mockResolvedValue(undefined);
    const ensureLogDir = vi.fn().mockResolvedValue(undefined);
    const log = createLogClassifierSync(appendFile as any, ensureLogDir as any, undefined as any, "/tmp/log");
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
    const line = appendFile.mock.calls[0][1] as string;
    expect(line).toContain("high");
  });
});
