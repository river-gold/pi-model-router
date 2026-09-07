import { describe, expect, it, vi } from "vitest";
import { resolveContextWindow, resolveMaxTokens } from "../../src/config/registry";
import type { RouterProfile } from "../../src/types";

describe("registry를 검증함", () => {
  describe("resolveContextWindow 동작을 검증함", () => {
    it("tier 누락 시 기본값을 반환함을 검증함", () => {
      const profile: RouterProfile = {};
      expect(resolveContextWindow("high", profile, undefined)).toBe(128000);
    });
    it("사용자 contextWindow가 우선함을 검증함", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], contextWindow: 50000, resolvedContextWindow: 128000 },
      };
      expect(resolveContextWindow("high", profile as any, undefined)).toBe(50000);
    });
    it("0인 contextWindow는 무시하고 resolved 값으로 대체함을 검증함", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], contextWindow: 0, resolvedContextWindow: 99999 },
      };
      expect(resolveContextWindow("high", profile as any, undefined)).toBe(99999);
    });
    it("음수는 무시함을 검증함", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], contextWindow: -1, resolvedContextWindow: 11111 },
      };
      expect(resolveContextWindow("high", profile as any, undefined)).toBe(11111);
    });
    it("사용자 값 없으면 registry를 사용함을 검증함", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], resolvedContextWindow: 128000 },
      };
      const registry = { find: vi.fn().mockReturnValue({ contextWindow: 64000 }) } as any;
      expect(resolveContextWindow("high", profile, registry)).toBe(64000);
    });
    it("registry에 없으면 resolved 값으로 대체함을 검증함", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], resolvedContextWindow: 12345 },
      };
      const registry = { find: vi.fn().mockReturnValue(undefined) } as any;
      expect(resolveContextWindow("high", profile, registry)).toBe(12345);
    });
    it("registry에 contextWindow가 없으면 대체값을 검증함", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], resolvedContextWindow: 12345 },
      };
      const registry = { find: vi.fn().mockReturnValue({}) } as any;
      expect(resolveContextWindow("high", profile, registry)).toBe(12345);
    });
    it("registry find가 throw하면 대체값을 검증함", () => {
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
    it("잘못된 model ref면 대체값을 검증함", () => {
      const profile: RouterProfile = {
        high: { models: ["invalid"], resolvedContextWindow: 99999 },
      };
      const registry = { find: vi.fn() } as any;
      expect(resolveContextWindow("high", profile, registry)).toBe(99999);
      expect(registry.find).not.toHaveBeenCalled();
    });
    it("registry가 없으면 대체값을 검증함", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], resolvedContextWindow: 77777 },
      };
      expect(resolveContextWindow("high", profile, undefined)).toBe(77777);
    });
    it("resolvedContextWindow가 undefined면 기본값을 검증함", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"] } as any,
      };
      expect(resolveContextWindow("high", profile, undefined)).toBe(128000);
    });
    it("models가 undefined면 catch 경유로 대체값을 검증함", () => {
      const profile: RouterProfile = {
        high: { resolvedContextWindow: 99999 } as any,
      };
      const registry = { find: vi.fn() } as any;
      expect(resolveContextWindow("high", profile, registry)).toBe(99999);
      expect(registry.find).not.toHaveBeenCalled();
    });
    it("빈 models 배열이면 catch 경유로 대체값을 검증함", () => {
      const profile: RouterProfile = {
        high: { models: [], resolvedContextWindow: 88888 } as any,
      };
      const registry = { find: vi.fn() } as any;
      expect(resolveContextWindow("high", profile, registry)).toBe(88888);
    });
    it("registry가 0인 contextWindow를 반환하면 대체값을 검증함", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], resolvedContextWindow: 77777 },
      };
      const registry = { find: vi.fn().mockReturnValue({ contextWindow: 0 }) } as any;
      expect(resolveContextWindow("high", profile, registry)).toBe(77777);
    });
  });

  describe("resolveMaxTokens 동작을 검증함", () => {
    it("tier 누락 시 기본값을 반환함을 검증함", () => {
      expect(resolveMaxTokens("high", {}, undefined)).toBe(16384);
    });
    it("사용자 maxTokens가 우선함을 검증함", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], maxTokens: 2000, resolvedMaxTokens: 16384 },
      };
      expect(resolveMaxTokens("high", profile as any, undefined)).toBe(2000);
    });
    it("0은 무시함을 검증함", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], maxTokens: 0, resolvedMaxTokens: 9999 },
      };
      expect(resolveMaxTokens("high", profile as any, undefined)).toBe(9999);
    });
    it("registry를 사용함을 검증함", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], resolvedMaxTokens: 16384 },
      };
      const registry = { find: vi.fn().mockReturnValue({ maxTokens: 8000 }) } as any;
      expect(resolveMaxTokens("high", profile, registry)).toBe(8000);
    });
    it("registry에 없으면 대체값을 검증함", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], resolvedMaxTokens: 5555 },
      };
      const registry = { find: vi.fn().mockReturnValue(undefined) } as any;
      expect(resolveMaxTokens("high", profile, registry)).toBe(5555);
    });
    it("registry가 throw하면 대체값을 검증함", () => {
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
    it("잘못된 ref면 대체값을 검증함", () => {
      const profile: RouterProfile = { high: { models: ["bad"], resolvedMaxTokens: 1111 } };
      const registry = { find: vi.fn() } as any;
      expect(resolveMaxTokens("high", profile, registry)).toBe(1111);
    });
    it("registry가 없으면 대체값을 검증함", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], resolvedMaxTokens: 2222 },
      };
      expect(resolveMaxTokens("high", profile, undefined)).toBe(2222);
    });
    it("resolved가 undefined면 기본값을 검증함", () => {
      const profile: RouterProfile = { high: { models: ["openai/gpt-4o"] } as any };
      expect(resolveMaxTokens("high", profile, undefined)).toBe(16384);
    });
    it("models가 undefined면 대체값을 검증함", () => {
      const profile: RouterProfile = { high: { resolvedMaxTokens: 99999 } as any };
      const registry = { find: vi.fn() } as any;
      expect(resolveMaxTokens("high", profile, registry)).toBe(99999);
    });
    it("registry가 0인 maxTokens를 반환하면 대체값을 검증함", () => {
      const profile: RouterProfile = {
        high: { models: ["openai/gpt-4o"], resolvedMaxTokens: 77777 },
      };
      const registry = { find: vi.fn().mockReturnValue({ maxTokens: 0 }) } as any;
      expect(resolveMaxTokens("high", profile, registry)).toBe(77777);
    });
  });
});
