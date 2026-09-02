import { describe, it, expect } from "vitest";
import routerExtension from "../index";
import extension from "../src/extension";

describe("index re-export", () => {
  it("re-exports routerExtension from src/extension", () => {
    expect(routerExtension).toBe(extension);
  });
});
