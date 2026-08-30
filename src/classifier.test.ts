import { describe, it, expect, vi } from 'vitest';
import { runClassifier, CLASSIFIER_SYSTEM_PROMPT } from './classifier';
import { streamSimple } from '@earendil-works/pi-ai/compat';
import type { Context } from '@earendil-works/pi-ai';

vi.mock('@earendil-works/pi-ai/compat', () => ({
  streamSimple: vi.fn(),
}));

describe('classifier.ts', () => {
  const mockRegistry = {
    find: (provider: string, modelId: string) => {
      if (provider === 'openai' && modelId === 'gpt-4o') {
        return { provider, id: modelId, reasoning: true } as unknown as never;
      }
      return undefined;
    },
    getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: 'k', headers: {} }),
    getProviderAuth: async () => undefined,
  } as unknown as import('@earendil-works/pi-coding-agent').ExtensionContext['modelRegistry'];

  const baseContext: Context = {
    messages: [{ role: 'user', content: 'hello', timestamp: 1 }],
  };

  it('should return tier and reasoning from LLM', async () => {
    const s = (async function* () {
      yield { type: 'text_delta', delta: 'Tier: high\n' };
      yield { type: 'text_delta', delta: 'Reasoning: test' };
    })();
    vi.mocked(streamSimple).mockReturnValue(s as unknown as ReturnType<typeof streamSimple>);
    const r = await runClassifier('openai/gpt-4o', mockRegistry, baseContext, 'off' as unknown as import('@earendil-works/pi-agent-core').ThinkingLevel);
    expect(r).toEqual({ tier: 'high', reasoning: 'test' });
  });

  it('should return undefined on invalid format', async () => {
    const s = (async function* () {
      yield { type: 'text_delta', delta: 'invalid' };
    })();
    vi.mocked(streamSimple).mockReturnValue(s as unknown as ReturnType<typeof streamSimple>);
    const r = await runClassifier('openai/gpt-4o', mockRegistry, baseContext);
    expect(r).toBeUndefined();
  });

  it('should return undefined if model not found', async () => {
    const r = await runClassifier('unknown/model', mockRegistry, baseContext);
    expect(r).toBeUndefined();
  });

  it('should pass history when historySize >0', async () => {
    const s = (async function* () {
      yield { type: 'text_delta', delta: 'Tier: low\nReasoning: ok' };
    })();
    vi.mocked(streamSimple).mockReturnValue(s as unknown as ReturnType<typeof streamSimple>);
    const ctx: Context = {
      messages: [
        { role: 'user', content: 'u1', timestamp: 1 },
        { role: 'assistant', content: 'a1', timestamp: 2 } as unknown as import('@earendil-works/pi-ai').Message,
        { role: 'user', content: 'cur', timestamp: 3 },
      ],
    };
    await runClassifier('openai/gpt-4o', mockRegistry, ctx, 1, 'off' as unknown as import('@earendil-works/pi-agent-core').ThinkingLevel);
    const called = vi.mocked(streamSimple).mock.calls.at(-1)?.[1] as Context;
    expect(called.messages[0].content as string).toContain('u1');
    expect(called.messages[0].content as string).toContain('a1');
    expect(called.systemPrompt).toBe(CLASSIFIER_SYSTEM_PROMPT);
  });

  it('should handle historySize as number and thinking as string overload', async () => {
    const s1 = (async function* () {
      yield { type: 'text_delta', delta: 'Tier: medium\nReasoning: ok' };
    })();
    const s2 = (async function* () {
      yield { type: 'text_delta', delta: 'Tier: medium\nReasoning: ok' };
    })();
    vi.mocked(streamSimple).mockReturnValueOnce(s1 as unknown as ReturnType<typeof streamSimple>).mockReturnValueOnce(s2 as unknown as ReturnType<typeof streamSimple>);
    const r1 = await runClassifier('openai/gpt-4o', mockRegistry, baseContext, 'high' as unknown as import('@earendil-works/pi-agent-core').ThinkingLevel);
    expect(r1?.tier).toBe('medium');
    const r2 = await runClassifier('openai/gpt-4o', mockRegistry, baseContext, 2, 'high' as unknown as import('@earendil-works/pi-agent-core').ThinkingLevel);
    expect(r2?.tier).toBe('medium');
  });
});
