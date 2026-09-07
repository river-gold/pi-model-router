import { describe, expect, it, vi } from "vitest";
import { createEnsureLogDir } from "../../src/logger/ensure";

describe("logger/ensure 로그 디렉터리 보장", () => {
  it("mkdir을 올바른 경로로 호출하고 캐시한다", async () => {
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

  it("mkdir 실패를 그대로 전파한다", async () => {
    const mkdir = vi.fn().mockRejectedValue(new Error("fail"));
    const ensure = createEnsureLogDir(mkdir as any, undefined as any, "/tmp/log/file.log");
    await expect(ensure()).rejects.toThrow("fail");
    // second call still tries? Since ensureDir is rejected promise, next call returns same rejected promise
    await expect(ensure()).rejects.toThrow("fail");
    expect(mkdir).toHaveBeenCalledTimes(1);
  });

  it("_reset은 캐시를 비운다", async () => {
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const ensure: any = createEnsureLogDir(mkdir as any, undefined as any, "/tmp/log/file.log");
    await ensure();
    expect(mkdir).toHaveBeenCalledTimes(1);
    ensure._reset();
    await ensure();
    expect(mkdir).toHaveBeenCalledTimes(2);
  });

  it("동시 호출에는 같은 promise를 반환한다", async () => {
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
