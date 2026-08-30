import { describe, it, expect, vi } from 'vitest';
import { formatDecision, formatModelRef, updateStatus } from './ui';
import type { RoutingDecision } from './types';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

describe('ui.ts', () => {
  const buildMockCtx = () => ({
    ui: { setStatus: vi.fn() },
  });

  const decision: RoutingDecision = {
    profile: 'balanced',
    tier: 'high',    targetProvider: 'google',
    targetModelId: 'gemini-2.5-pro',
    targetLabel: 'google/gemini-2.5-pro',
    reasoning: 'Exploratory prompts',
    thinking: 'high',
    timestamp: Date.now(),
  };

  describe('formatters', () => {
    it('should format routing decision correctly', () => {
      expect(formatDecision(decision)).toBe(
        'balanced: high -> google/gemini-2.5-pro [high] (Exploratory prompts)',
      );
    });

    it('should format model references', () => {
      expect(formatModelRef('openai/gpt-4o')).toBe('openai/gpt-4o');
      expect(formatModelRef(undefined)).toBe('none');
    });
  });

  describe('updateStatus', () => {
    it('should remove status if disabled', () => {
      const ctx = buildMockCtx() as unknown as ExtensionContext;
      updateStatus(ctx, false, 'balanced', undefined);
      expect(ctx.ui.setStatus).toHaveBeenCalledWith('router', undefined);
    });

    it('should update status to waiting if no matching decision exists', () => {
      const ctx = buildMockCtx() as unknown as ExtensionContext;
      updateStatus(ctx, true, 'balanced', undefined);
      expect(ctx.ui.setStatus).toHaveBeenCalledWith(
        'router',
        '🚥 router:balanced -> waiting',
      );
    });

    it('should display the last routed decision for the active profile', () => {
      const ctx = buildMockCtx() as unknown as ExtensionContext;
      updateStatus(ctx, true, 'balanced', decision);
      expect(ctx.ui.setStatus).toHaveBeenCalledWith(
        'router',
        '🚥 router:balanced -> high -> google/gemini-2.5-pro (high)',
      );
    });

    it('should show waiting when the active profile differs from the decision', () => {
      const ctx = buildMockCtx() as unknown as ExtensionContext;
      updateStatus(ctx, true, 'balanced', { ...decision, profile: 'other-profile' });
      expect(ctx.ui.setStatus).toHaveBeenCalledWith(
        'router',
        '🚥 router:balanced -> waiting',
      );
    });
  });
});
