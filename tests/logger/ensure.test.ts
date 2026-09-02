import { describe, expect, it, vi } from "vitest";
import { createEnsureLogDir } from "../../src/logger/ensure";

describe("logger/ensure", () => {
  it("calls mkdir with correct path and caches", async () => {
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const dirname = vi
      .fn()
      .mockImplementation((p: string) => p.split("/").slice(0, -1).join("/") || "/");
    const ensure = createEnsureLogDir(mkdir as any, dirname as any, "/tmp/log/file.log");
    await ensure();
    expect(mkdir).toHaveBeenCalledWith("/tmp/log", { recursive: true });
    expect(mkdir).toHaveBeenCalledTimes(1);
    await ensure();
    expect(mkdir).toHaveBeenCalledTimes(1); // cached
  });

  it("handles mkdir failure propagates", async () => {
    const mkdir = vi.fn().mockRejectedValue(new Error("fail"));
    const ensure = createEnsureLogDir(mkdir as any, undefined as any, "/tmp/log/file.log");
    await expect(ensure()).rejects.toThrow("fail");
    // second call still tries? Since ensureDir is rejected promise, next call returns same rejected promise
    await expect(ensure()).rejects.toThrow("fail");
    expect(mkdir).toHaveBeenCalledTimes(1);
  });

  it("_reset clears cache", async () => {
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const ensure: any = createEnsureLogDir(mkdir as any, undefined as any, "/tmp/log/file.log");
    await ensure();
    expect(mkdir).toHaveBeenCalledTimes(1);
    ensure._reset();
    await ensure();
    expect(mkdir).toHaveBeenCalledTimes(2);
  });

  it("returns same promise on concurrent calls", async () => {
    let resolve: () => void = () => {};
    const mkdir = vi.fn().mockImplementation(() => new Promise<void>((r) => (resolve = r)));
    const ensure = createEnsureLogDir(mkdir as any, undefined as any, "/tmp/log/file.log");
    const p1 = ensure();
    const p2 = ensure();
    expect(mkdir).toHaveBeenCalledTimes(1);
    resolve();
    await p1;
    await p2;
  });
});
