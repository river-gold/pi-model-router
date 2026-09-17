import { describe, expect, it, vi } from "vitest";
import {
  resolveContextWindow,
  resolveContextWindowLive,
  resolveMaxTokens,
  resolveMaxTokensLive,
} from "../../src/config/registry";
import type { Router } from "../../src/types";
import { makeFakeRegistry } from "../helpers";

describe("registry를 검증함", () => {
  describe("resolveContextWindow 동작을 검증함", () => {
    it("tier 누락 시 기본값을 반환함을 검증함", () => {
      const router: Router = {};
      expect(resolveContextWindow("high", router, undefined)).toBe(128000);
    });
    it("사용자 contextWindow가 우선함을 검증함", () => {
      const router: Router = {
        high: { models: ["openai/gpt-4o"], contextWindow: 50000, resolvedContextWindow: 128000 },
      };
      expect(resolveContextWindow("high", router, undefined)).toBe(50000);
    });
    it("0인 contextWindow는 무시하고 resolved 값으로 대체함을 검증함", () => {
      const router: Router = {
        high: { models: ["openai/gpt-4o"], contextWindow: 0, resolvedContextWindow: 99999 },
      };
      expect(resolveContextWindow("high", router, undefined)).toBe(99999);
    });
    it("음수는 무시함을 검증함", () => {
      const router: Router = {
        high: { models: ["openai/gpt-4o"], contextWindow: -1, resolvedContextWindow: 11111 },
      };
      expect(resolveContextWindow("high", router, undefined)).toBe(11111);
    });
    it("사용자 값 없으면 registry를 사용함을 검증함", () => {
      const router: Router = {
        high: { models: ["openai/gpt-4o"], resolvedContextWindow: 128000 },
      };
      const registry = makeFakeRegistry({
        find: vi.fn().mockReturnValue({ contextWindow: 64000 }),
      });
      expect(resolveContextWindow("high", router, registry)).toBe(64000);
    });
    it("registry에 없으면 resolved 값으로 대체함을 검증함", () => {
      const router: Router = {
        high: { models: ["openai/gpt-4o"], resolvedContextWindow: 12345 },
      };
      const registry = makeFakeRegistry({ find: vi.fn().mockReturnValue(undefined) });
      expect(resolveContextWindow("high", router, registry)).toBe(12345);
    });
    it("registry에 contextWindow가 없으면 대체값을 검증함", () => {
      const router: Router = {
        high: { models: ["openai/gpt-4o"], resolvedContextWindow: 12345 },
      };
      const registry = makeFakeRegistry({ find: vi.fn().mockReturnValue({}) });
      expect(resolveContextWindow("high", router, registry)).toBe(12345);
    });
    it("registry find가 throw하면 대체값을 검증함", () => {
      const router: Router = {
        high: { models: ["openai/gpt-4o"], resolvedContextWindow: 12345 },
      };
      const registry = makeFakeRegistry({
        find: vi.fn().mockImplementation(() => {
          throw new Error("fail");
        }),
      });
      expect(resolveContextWindow("high", router, registry)).toBe(12345);
    });
    it("잘못된 model ref면 대체값을 검증함", () => {
      const router: Router = {
        high: { models: ["invalid"], resolvedContextWindow: 99999 },
      };
      const find = vi.fn();
      const registry = makeFakeRegistry({ find });
      expect(resolveContextWindow("high", router, registry)).toBe(99999);
      expect(find).not.toHaveBeenCalled();
    });
    it("registry가 없으면 대체값을 검증함", () => {
      const router: Router = {
        high: { models: ["openai/gpt-4o"], resolvedContextWindow: 77777 },
      };
      expect(resolveContextWindow("high", router, undefined)).toBe(77777);
    });
    it("resolvedContextWindow가 undefined면 기본값을 검증함", () => {
      const router: Router = {
        high: { models: ["openai/gpt-4o"] },
      };
      expect(resolveContextWindow("high", router, undefined)).toBe(128000);
    });
    it("models가 undefined면 catch 경유로 대체값을 검증함", () => {
      const router: Router = {
        high: { resolvedContextWindow: 99999 },
      };
      const find = vi.fn();
      const registry = makeFakeRegistry({ find });
      expect(resolveContextWindow("high", router, registry)).toBe(99999);
      expect(find).not.toHaveBeenCalled();
    });
    it("빈 models 배열이면 catch 경유로 대체값을 검증함", () => {
      const router: Router = {
        high: { models: [], resolvedContextWindow: 88888 },
      };
      const registry = makeFakeRegistry({ find: vi.fn() });
      expect(resolveContextWindow("high", router, registry)).toBe(88888);
    });
    it("registry가 0인 contextWindow를 반환하면 대체값을 검증함", () => {
      const router: Router = {
        high: { models: ["openai/gpt-4o"], resolvedContextWindow: 77777 },
      };
      const registry = makeFakeRegistry({
        find: vi.fn().mockReturnValue({ contextWindow: 0 }),
      });
      expect(resolveContextWindow("high", router, registry)).toBe(77777);
    });
  });

  describe("resolveMaxTokens 동작을 검증함", () => {
    it("tier 누락 시 기본값을 반환함을 검증함", () => {
      expect(resolveMaxTokens("high", {}, undefined)).toBe(16384);
    });
    it("사용자 maxTokens가 우선함을 검증함", () => {
      const router: Router = {
        high: { models: ["openai/gpt-4o"], maxTokens: 2000, resolvedMaxTokens: 16384 },
      };
      expect(resolveMaxTokens("high", router, undefined)).toBe(2000);
    });
    it("0은 무시함을 검증함", () => {
      const router: Router = {
        high: { models: ["openai/gpt-4o"], maxTokens: 0, resolvedMaxTokens: 9999 },
      };
      expect(resolveMaxTokens("high", router, undefined)).toBe(9999);
    });
    it("registry를 사용함을 검증함", () => {
      const router: Router = {
        high: { models: ["openai/gpt-4o"], resolvedMaxTokens: 16384 },
      };
      const registry = makeFakeRegistry({
        find: vi.fn().mockReturnValue({ maxTokens: 8000 }),
      });
      expect(resolveMaxTokens("high", router, registry)).toBe(8000);
    });
    it("registry에 없으면 대체값을 검증함", () => {
      const router: Router = {
        high: { models: ["openai/gpt-4o"], resolvedMaxTokens: 5555 },
      };
      const registry = makeFakeRegistry({ find: vi.fn().mockReturnValue(undefined) });
      expect(resolveMaxTokens("high", router, registry)).toBe(5555);
    });
    it("registry가 throw하면 대체값을 검증함", () => {
      const router: Router = {
        high: { models: ["openai/gpt-4o"], resolvedMaxTokens: 5555 },
      };
      const registry = makeFakeRegistry({
        find: vi.fn().mockImplementation(() => {
          throw new Error("x");
        }),
      });
      expect(resolveMaxTokens("high", router, registry)).toBe(5555);
    });
    it("잘못된 ref면 대체값을 검증함", () => {
      const router: Router = { high: { models: ["bad"], resolvedMaxTokens: 1111 } };
      const registry = makeFakeRegistry({ find: vi.fn() });
      expect(resolveMaxTokens("high", router, registry)).toBe(1111);
    });
    it("registry가 없으면 대체값을 검증함", () => {
      const router: Router = {
        high: { models: ["openai/gpt-4o"], resolvedMaxTokens: 2222 },
      };
      expect(resolveMaxTokens("high", router, undefined)).toBe(2222);
    });
    it("resolved가 undefined면 기본값을 검증함", () => {
      const router: Router = { high: { models: ["openai/gpt-4o"] } };
      expect(resolveMaxTokens("high", router, undefined)).toBe(16384);
    });
    it("models가 undefined면 대체값을 검증함", () => {
      const router: Router = { high: { resolvedMaxTokens: 99999 } };
      const registry = makeFakeRegistry({ find: vi.fn() });
      expect(resolveMaxTokens("high", router, registry)).toBe(99999);
    });
    it("registry가 0인 maxTokens를 반환하면 대체값을 검증함", () => {
      const router: Router = {
        high: { models: ["openai/gpt-4o"], resolvedMaxTokens: 77777 },
      };
      const registry = makeFakeRegistry({
        find: vi.fn().mockReturnValue({ maxTokens: 0 }),
      });
      expect(resolveMaxTokens("high", router, registry)).toBe(77777);
    });
  });
  describe("위임 tier 해석을 검증함", () => {
    it("위임 tier는 기본 contextWindow를 검증함", () => {
      const router: Router = { high: { models: ["@copilot#high"] } };
      expect(resolveContextWindow("high", router, undefined)).toBe(128000);
    });
    it("위임 tier는 기본 maxTokens를 검증함", () => {
      const router: Router = { high: { models: ["@copilot#high"] } };
      expect(resolveMaxTokens("high", router, undefined)).toBe(16384);
    });
    it("live로 추적된 사용자 contextWindow를 검증함", () => {
      const routers: Record<string, Router> = {
        auto: { medium: { models: ["@copilot#high"], contextWindow: 50000 } },
        copilot: {
          high: { models: ["openai/gpt-4o"] },
        },
      };
      expect(resolveContextWindowLive(routers, "auto", "medium", undefined)).toBe(50000);
    });
    it("live로 추적된 사용자 maxTokens를 검증함", () => {
      const routers: Record<string, Router> = {
        auto: { medium: { models: ["@copilot#high"], maxTokens: 4000 } },
        copilot: {
          high: { models: ["openai/gpt-4o"] },
        },
      };
      expect(resolveMaxTokensLive(routers, "auto", "medium", undefined)).toBe(4000);
    });
    it("live 해석 불가 시 기본 contextWindow를 검증함", () => {
      const routers: Record<string, Router> = {
        auto: { medium: { models: ["@missing#high"] } },
      };
      expect(resolveContextWindowLive(routers, "auto", "medium", undefined)).toBe(128000);
    });
    it("live 해석 불가 시 기본 maxTokens를 검증함", () => {
      const routers: Record<string, Router> = {
        auto: { medium: { models: ["@missing#high"] } },
      };
      expect(resolveMaxTokensLive(routers, "auto", "medium", undefined)).toBe(16384);
    });
  });
});
