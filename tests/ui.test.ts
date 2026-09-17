import { describe, it, expect, vi } from "vitest";
import { formatDecision, formatModelRef, updateStatus } from "../src/ui";
import type { RoutingDecision } from "../src/types";
import { makeFakeExtensionContext, makeFakeUi } from "./helpers";

describe("ui.ts UI는", () => {
  const buildMockCtx = () => {
    const setStatus = vi.fn();
    return { ctx: makeFakeExtensionContext({ ui: makeFakeUi({ setStatus }) }), setStatus };
  };

  const decision: RoutingDecision = {
    router: "balanced",
    tier: "high",
    targetProvider: "google",
    targetModelId: "gemini-2.5-pro",
    targetLabel: "google/gemini-2.5-pro",
    reasoning: "Exploratory prompts",
    effort: "high",
    timestamp: Date.now(),
  };

  describe("formatters 포맷터는", () => {
    it("routing decision을 올바르게 포맷한다", () => {
      expect(formatDecision(decision)).toBe(
        "balanced: high -> google/gemini-2.5-pro [high] (Exploratory prompts)",
      );
    });

    it("thinking이 undefined이면 auto로 fallback한다", () => {
      const withoutThinking: RoutingDecision = { ...decision, effort: undefined };
      expect(formatDecision(withoutThinking)).toBe(
        "balanced: high -> google/gemini-2.5-pro [auto] (Exploratory prompts)",
      );
    });

    it("model 참조를 포맷한다", () => {
      expect(formatModelRef("openai/gpt-4o")).toBe("openai/gpt-4o");
      expect(formatModelRef(undefined)).toBe("none");
    });
  });

  describe("updateStatus 상태 업데이트는", () => {
    it("비활성화되면 status를 제거한다", () => {
      const { ctx, setStatus } = buildMockCtx();
      updateStatus(ctx, false, "balanced", undefined);
      expect(setStatus).toHaveBeenCalledWith("router", undefined);
    });

    it("일치하는 decision이 없으면 status를 waiting으로 업데이트한다", () => {
      const { ctx, setStatus } = buildMockCtx();
      updateStatus(ctx, true, "balanced", undefined);
      expect(setStatus).toHaveBeenCalledWith("router", "🚥 router:balanced -> waiting");
    });

    it("활성 router의 마지막 라우팅된 decision을 표시한다", () => {
      const { ctx, setStatus } = buildMockCtx();
      updateStatus(ctx, true, "balanced", decision);
      expect(setStatus).toHaveBeenCalledWith(
        "router",
        "🚥 router:balanced -> high -> google/gemini-2.5-pro (high)",
      );
    });

    it("활성 router이 decision과 다르면 waiting을 표시한다", () => {
      const { ctx, setStatus } = buildMockCtx();
      updateStatus(ctx, true, "balanced", {
        ...decision,
        router: "other-router",
      });
      expect(setStatus).toHaveBeenCalledWith("router", "🚥 router:balanced -> waiting");
    });

    it("lastDecision thinking이 undefined이면 auto로 fallback한다", () => {
      const { ctx, setStatus } = buildMockCtx();
      const withoutThinking: RoutingDecision = { ...decision, effort: undefined };
      updateStatus(ctx, true, "balanced", withoutThinking);
      expect(setStatus).toHaveBeenCalledWith(
        "router",
        "🚥 router:balanced -> high -> google/gemini-2.5-pro (auto)",
      );
    });
  });
});
