import { describe, expect, it, vi } from "vitest";
import { resolveContextWindow, resolveMaxTokens } from "../../src/config/registry";
import type { RouterProfile } from "../../src/types";

describe("registry", () => {
  describe("resolveContextWindow", () => {
    it("tier missing -> default", () => {
      const profile: RouterProfile = {};
      expect(resolveContextWindow("high", profile, undefined)).toBe(128000);
    });
    it("user contextWindow takes precedence", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], contextWindow: 50000, resolvedContextWindow: 128000 },
      };
      expect(resolveContextWindow("high", profile as any, undefined)).toBe(50000);
    });
    it("zero contextWindow ignored -> fallback to resolved", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], contextWindow: 0, resolvedContextWindow: 99999 },
      };
      expect(resolveContextWindow("high", profile as any, undefined)).toBe(99999);
    });
    it("negative ignored", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], contextWindow: -1, resolvedContextWindow: 11111 },
      };
      expect(resolveContextWindow("high", profile as any, undefined)).toBe(11111);
    });
    it("uses registry when no user value", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], resolvedContextWindow: 128000 },
      };
      const registry = { find: vi.fn().mockReturnValue({ contextWindow: 64000 }) } as any;
      expect(resolveContextWindow("high", profile, registry)).toBe(64000);
    });
    it("registry miss -> fallback to resolved", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], resolvedContextWindow: 12345 },
      };
      const registry = { find: vi.fn().mockReturnValue(undefined) } as any;
      expect(resolveContextWindow("high", profile, registry)).toBe(12345);
    });
    it("registry has no contextWindow -> fallback", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], resolvedContextWindow: 12345 },
      };
      const registry = { find: vi.fn().mockReturnValue({}) } as any;
      expect(resolveContextWindow("high", profile, registry)).toBe(12345);
    });
    it("registry find throws -> fallback", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], resolvedContextWindow: 12345 },
      };
      const registry = {
        find: vi.fn().mockImplementation(() => {
          throw new Error("fail");
        }),
      } as any;
      expect(resolveContextWindow("high", profile, registry)).toBe(12345);
    });
    it("invalid model ref -> fallback", () => {
      const profile: RouterProfile = {
        high: { models: ["invalid"], resolvedContextWindow: 99999 },
      };
      const registry = { find: vi.fn() } as any;
      expect(resolveContextWindow("high", profile, registry)).toBe(99999);
      expect(registry.find).not.toHaveBeenCalled();
    });
    it("no registry -> fallback", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], resolvedContextWindow: 77777 },
      };
      expect(resolveContextWindow("high", profile, undefined)).toBe(77777);
    });
    it("resolvedContextWindow undefined -> default", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"] } as any,
      };
      expect(resolveContextWindow("high", profile, undefined)).toBe(128000);
    });
    it("models undefined -> fallback via catch", () => {
      const profile: RouterProfile = {
        high: { resolvedContextWindow: 99999 } as any,
      };
      const registry = { find: vi.fn() } as any;
      expect(resolveContextWindow("high", profile, registry)).toBe(99999);
      expect(registry.find).not.toHaveBeenCalled();
    });
    it("models empty array -> fallback via catch", () => {
      const profile: RouterProfile = {
        high: { models: [], resolvedContextWindow: 88888 } as any,
      };
      const registry = { find: vi.fn() } as any;
      expect(resolveContextWindow("high", profile, registry)).toBe(88888);
    });
    it("registry returns 0 contextWindow -> fallback", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], resolvedContextWindow: 77777 },
      };
      const registry = { find: vi.fn().mockReturnValue({ contextWindow: 0 }) } as any;
      expect(resolveContextWindow("high", profile, registry)).toBe(77777);
    });
  });

  describe("resolveMaxTokens", () => {
    it("tier missing -> default", () => {
      expect(resolveMaxTokens("high", {}, undefined)).toBe(16384);
    });
    it("user maxTokens precedence", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], maxTokens: 2000, resolvedMaxTokens: 16384 },
      };
      expect(resolveMaxTokens("high", profile as any, undefined)).toBe(2000);
    });
    it("zero ignored", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], maxTokens: 0, resolvedMaxTokens: 9999 },
      };
      expect(resolveMaxTokens("high", profile as any, undefined)).toBe(9999);
    });
    it("uses registry", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], resolvedMaxTokens: 16384 },
      };
      const registry = { find: vi.fn().mockReturnValue({ maxTokens: 8000 }) } as any;
      expect(resolveMaxTokens("high", profile, registry)).toBe(8000);
    });
    it("registry miss -> fallback", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], resolvedMaxTokens: 5555 },
      };
      const registry = { find: vi.fn().mockReturnValue(undefined) } as any;
      expect(resolveMaxTokens("high", profile, registry)).toBe(5555);
    });
    it("registry throws -> fallback", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], resolvedMaxTokens: 5555 },
      };
      const registry = {
        find: vi.fn().mockImplementation(() => {
          throw new Error("x");
        }),
      } as any;
      expect(resolveMaxTokens("high", profile, registry)).toBe(5555);
    });
    it("invalid ref -> fallback", () => {
      const profile: RouterProfile = { high: { models: ["bad"], resolvedMaxTokens: 1111 } };
      const registry = { find: vi.fn() } as any;
      expect(resolveMaxTokens("high", profile, registry)).toBe(1111);
    });
    it("no registry -> fallback", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], resolvedMaxTokens: 2222 },
      };
      expect(resolveMaxTokens("high", profile, undefined)).toBe(2222);
    });
    it("resolved undefined -> default", () => {
      const profile: RouterProfile = { high: { models: ["openai/gpt-4o"] } as any };
      expect(resolveMaxTokens("high", profile, undefined)).toBe(16384);
    });
    it("models undefined -> fallback", () => {
      const profile: RouterProfile = { high: { resolvedMaxTokens: 99999 } as any };
      const registry = { find: vi.fn() } as any;
      expect(resolveMaxTokens("high", profile, registry)).toBe(99999);
    });
    it("registry returns 0 maxTokens -> fallback", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], resolvedMaxTokens: 77777 },
      };
      const registry = { find: vi.fn().mockReturnValue({ maxTokens: 0 }) } as any;
      expect(resolveMaxTokens("high", profile, registry)).toBe(77777);
    });
  });
});
