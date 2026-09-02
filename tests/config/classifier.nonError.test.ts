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

describe("non-Error throw branch", () => {
  it("normalizeClassifierConfig handles non-Error throw via String(error)", async () => {
    const w: string[] = [];
    const r = normalizeClassifierConfig("openai/gpt-4o", w, "classifierModels");
    expect(r).toBeUndefined();
    expect(w[0]).toBe("Invalid classifierModels: string error");
  });

  it("normalizeTierConfig handles non-Error throw", async () => {
    const w: string[] = [];
    const r = normalizeTierConfig({ models: ["openai/gpt-4o"] }, "p", "high", w);
    // parseCanonicalModelRef mocked to throw string, so models push fails and goes to catch
    expect(r).toBeUndefined();
    expect(w[0]).toMatch(/Invalid model/);
    expect(w[0]).toBe('Invalid model "openai/gpt-4o" in profile "p" high tier: string error');
  });
});
