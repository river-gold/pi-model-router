import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { agyLabel, runAgyEntry } from "../../src/provider/agyEntry";
import type * as ClassifyModule from "../../src/agy/classify";
import type { TierGuides } from "../../src/types";
import { makeFakeExtensionContext, makeFakeUi } from "../helpers";

const { mockClassifyWithAgy } = vi.hoisted(() => ({
  mockClassifyWithAgy: vi.fn(),
}));

vi.mock("../../src/agy/classify", async () => {
  const actual = await vi.importActual<typeof ClassifyModule>("../../src/agy/classify");
  return { ...actual, classifyWithAgy: mockClassifyWithAgy };
});

const ctx: Context = { messages: [{ role: "user", content: "hi", timestamp: 1 }] };
const entry = { agy: true, model: "gemini-3.7-flash", effort: "high" } as const;

const makeState = (
  over: {
    tierGuides?: TierGuides;
    lastExtensionContext?: ExtensionContext | undefined;
  } = {},
) => ({
  currentConfig: over.tierGuides ? { tierGuides: over.tierGuides } : {},
  lastExtensionContext: over.lastExtensionContext,
});

describe("agyLabel 라벨 형식을 검증함", () => {
  it("effort 유무에 따라 라벨을 만듦을 검증함", () => {
    expect(agyLabel({ agy: true, model: "m" })).toBe("agy/m");
    expect(agyLabel({ agy: true, model: "m", effort: "low" })).toBe("agy/m#low");
  });
});

describe("runAgyEntry 체인 항목 실행을 검증함", () => {
  beforeEach(() => vi.clearAllMocks());

  it("이미 abort된 signal이면 호출 없이 aborted를 던짐을 검증함", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runAgyEntry(entry, makeState(), ctx, 0, controller.signal)).rejects.toThrow(
      "aborted",
    );
    expect(mockClassifyWithAgy).not.toHaveBeenCalled();
  });

  it("성공하면 result를 반환하고 working message를 정리함을 검증함", async () => {
    const ui = makeFakeUi();
    mockClassifyWithAgy.mockResolvedValue({
      result: { tier: "high", reasoning: "Classifier decision." },
    });
    const extensionContext = makeFakeExtensionContext({ ui });
    const outcome = await runAgyEntry(
      entry,
      makeState({ lastExtensionContext: extensionContext }),
      ctx,
      2,
      undefined,
    );
    expect(outcome).toEqual({
      result: { tier: "high", reasoning: "Classifier decision." },
    });
    expect(ui.setWorkingMessage).toHaveBeenNthCalledWith(
      1,
      "Classifying via agy (agy/gemini-3.7-flash#high)...",
    );
    expect(ui.setWorkingMessage).toHaveBeenNthCalledWith(2, undefined);
    expect(mockClassifyWithAgy).toHaveBeenCalledWith(
      expect.objectContaining({
        context: ctx,
        model: "gemini-3.7-flash",
        effort: "high",
        historySize: 2,
        tierGuides: undefined,
        signal: undefined,
        cwd: extensionContext.cwd,
      }),
    );
  });

  it("tierGuides와 extension context cwd를 넘김을 검증함", async () => {
    const extensionContext = makeFakeExtensionContext();
    const tierGuides: TierGuides = { low: "Cheap work" };
    mockClassifyWithAgy.mockResolvedValue({
      result: { tier: "low", reasoning: "Classifier decision." },
    });
    await runAgyEntry(
      { agy: true, model: "m" },
      makeState({ tierGuides, lastExtensionContext: extensionContext }),
      ctx,
      0,
      undefined,
    );
    expect(mockClassifyWithAgy).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "m",
        effort: undefined,
        tierGuides,
        cwd: extensionContext.cwd,
      }),
    );
  });

  it("extension context가 없으면 process.cwd()를 넘김을 검증함", async () => {
    mockClassifyWithAgy.mockResolvedValue({
      result: { tier: "low", reasoning: "Classifier decision." },
    });
    await runAgyEntry({ agy: true, model: "m" }, makeState(), ctx, 0, undefined);
    expect(mockClassifyWithAgy).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: process.cwd() }),
    );
  });

  it("실패하면 attempt를 반환하고 working message를 정리함을 검증함", async () => {
    const ui = makeFakeUi();
    mockClassifyWithAgy.mockResolvedValue({ error: "agy classifier failed: timed out" });
    const outcome = await runAgyEntry(
      entry,
      makeState({ lastExtensionContext: makeFakeExtensionContext({ ui }) }),
      ctx,
      0,
      undefined,
    );
    expect(outcome).toEqual({
      attempt: { model: "agy/gemini-3.7-flash#high", error: "agy classifier failed: timed out" },
    });
    expect(ui.setWorkingMessage).toHaveBeenNthCalledWith(2, undefined);
  });

  it("classify 중 abort면 aborted를 던짐을 검증함", async () => {
    mockClassifyWithAgy.mockResolvedValue({ error: "aborted" });
    await expect(runAgyEntry(entry, makeState(), ctx, 0, undefined)).rejects.toThrow("aborted");
  });
});
