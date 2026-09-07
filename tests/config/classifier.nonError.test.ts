import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/modelRef", async () => {
  const actual = (await vi.importActual("../../src/config/modelRef")) as any;
  return {
    ...actual,
    parseCanonicalModelRef: vi.fn(() => {
      throw "string error";
    }),
  };
});

import { normalizeClassifierConfig } from "../../src/config/classifier";
import { normalizeTierConfig } from "../../src/config/tier";

describe("non-Error throw 분기를 검증함", () => {
  it("normalizeClassifierConfig가 String(error) 경유로 non-Error throw를 처리함을 검증함", async () => {
    const w: string[] = [];
    const r = normalizeClassifierConfig("openai/gpt-4o", w, "classifierModels");
    expect(r).toBeUndefined();
    expect(w[0]).toBe("Invalid classifierModels: string error");
  });

  it("normalizeTierConfig가 non-Error throw를 처리함을 검증함", async () => {
    const w: string[] = [];
    const r = normalizeTierConfig({ models: ["openai/gpt-4o"] }, "p", "high", w);
    // parseCanonicalModelRef mocked to throw string, so models push fails and goes to catch
    expect(r).toBeUndefined();
    expect(w[0]).toMatch(/Invalid model/);
    expect(w[0]).toBe('Invalid model "openai/gpt-4o" in profile "p" high tier: string error');
  });
});
