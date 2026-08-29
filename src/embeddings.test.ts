import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizePromptForEmbedding,
  embedTexts,
  embedText,
} from './embeddings';
import type { VectorCacheConfig } from './types';

const createConfig = (
  overrides: Partial<VectorCacheConfig> = {},
): VectorCacheConfig => ({
  enabled: true,
  threshold: 0.8,
  vectorFile: 'test.db',
  embeddingModel: 'test-model',
  embeddingBaseUrl: 'http://localhost:11434',
  backgroundRefresh: false,
  dimensions: 3,
  embeddingContextWindow: 8192,
  keepAlive: '5m',
  ...overrides,
});

describe('embeddings.ts', () => {
  describe('normalizePromptForEmbedding', () => {
    it('should trim whitespace', () => {
      expect(normalizePromptForEmbedding('  hello world  ')).toBe(
        'hello world',
      );
      expect(normalizePromptForEmbedding('\n\thello\n')).toBe('hello');
      expect(normalizePromptForEmbedding('   ')).toBe('');
    });

    it('should lowercase', () => {
      expect(normalizePromptForEmbedding('Hello WORLD')).toBe('hello world');
      expect(normalizePromptForEmbedding('TeSt MiXeD CaSe')).toBe(
        'test mixed case',
      );
    });

    it('should slice to 8000 characters', () => {
      const long = 'a'.repeat(9000);
      const result = normalizePromptForEmbedding(long);
      expect(result.length).toBe(8000);
      expect(result).toBe('a'.repeat(8000));
    });

    it('should slice after trim and lowercase', () => {
      const prefix = '  ';
      const suffix = '  ';
      const inner = 'A'.repeat(8010);
      const input = `${prefix}${inner}${suffix}`;
      const result = normalizePromptForEmbedding(input);
      expect(result.length).toBe(8000);
      expect(result).toBe('a'.repeat(8000));
    });

    it('should handle empty and short strings without slicing', () => {
      expect(normalizePromptForEmbedding('')).toBe('');
      expect(normalizePromptForEmbedding('abc')).toBe('abc');
      expect(normalizePromptForEmbedding('a'.repeat(8000))).toBe(
        'a'.repeat(8000),
      );
      expect(normalizePromptForEmbedding('a'.repeat(7999))).toBe(
        'a'.repeat(7999),
      );
    });
  });

  describe('embedTexts', () => {
    const originalFetch = globalThis.fetch;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
      globalThis.fetch = originalFetch;
    });

    it('should return undefined for empty array without calling fetch', async () => {
      const config = createConfig();
      const result = await embedTexts([], config);
      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return undefined when all inputs are whitespace without calling fetch', async () => {
      const config = createConfig();
      const result = await embedTexts(['   ', '\t\n', '  \n  '], config);
      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should filter whitespace entries and send only non-empty trimmed values', async () => {
      const config = createConfig();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
      } as unknown as Response);

      const resultPromise = embedTexts(['  hello  ', '   ', '\nworld\n'], config);
      // flush microtasks while timers still fake
      vi.advanceTimersByTime(0);
      const result = await resultPromise;

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const fetchCall = mockFetch.mock.calls[0] as unknown[];
      const url = fetchCall[0] as string;
      const init = fetchCall[1] as RequestInit;
      expect(url).toBe('http://localhost:11434/api/embed');
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['input']).toEqual(['hello', 'world']);
      expect(body['model']).toBe('test-model');
      expect(body['truncate']).toBe(true);
      expect(body['keep_alive']).toBe('5m');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(result).toEqual([[0.1, 0.2, 0.3]]);
    });

    it('should send single string as input when only one valid entry remains', async () => {
      const config = createConfig();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
      } as unknown as Response);

      const promise = embedTexts(['  hello  ', '   ', ' \t '], config);
      vi.advanceTimersByTime(0);
      await promise;

      const init = mockFetch.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['input']).toBe('hello');
    });

    it('should strip trailing slashes from baseUrl', async () => {
      const config = createConfig({ embeddingBaseUrl: 'http://localhost:11434///' });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embeddings: [[1, 2, 3]] }),
      } as unknown as Response);

      const promise = embedTexts(['hi'], config);
      vi.advanceTimersByTime(0);
      await promise;

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toBe('http://localhost:11434/api/embed');
    });

    it('should use keepAlive fallback to 5m when not provided', async () => {
      const config = createConfig({ keepAlive: undefined });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embeddings: [[1, 2, 3]] }),
      } as unknown as Response);

      const promise = embedTexts(['hi'], config);
      vi.advanceTimersByTime(0);
      await promise;

      const init = mockFetch.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['keep_alive']).toBe('5m');
    });

    it('should use custom keepAlive when provided', async () => {
      const config = createConfig({ keepAlive: '10m' });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embeddings: [[1, 2, 3]] }),
      } as unknown as Response);

      const promise = embedTexts(['hi'], config);
      vi.advanceTimersByTime(0);
      await promise;

      const init = mockFetch.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['keep_alive']).toBe('10m');
    });

    it('should return embeddings on success with embeddings plural', async () => {
      const config = createConfig();
      const embeddings = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ];
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embeddings }),
      } as unknown as Response);

      const promise = embedTexts(['hello', 'world'], config);
      vi.advanceTimersByTime(0);
      const result = await promise;
      expect(result).toEqual(embeddings);
    });

    it('should return single embedding wrapped in array when embedding singular', async () => {
      const config = createConfig();
      const embedding = [0.7, 0.8, 0.9];
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embedding }),
      } as unknown as Response);

      const promise = embedTexts(['hello'], config);
      vi.advanceTimersByTime(0);
      const result = await promise;
      expect(result).toEqual([embedding]);
    });

    it('should prefer embeddings over embedding when both present', async () => {
      const config = createConfig();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          embeddings: [[1, 1, 1]],
          embedding: [2, 2, 2],
        }),
      } as unknown as Response);

      const promise = embedTexts(['hi'], config);
      vi.advanceTimersByTime(0);
      const result = await promise;
      expect(result).toEqual([[1, 1, 1]]);
    });

    it('should return undefined when embeddings is empty array', async () => {
      const config = createConfig();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embeddings: [] }),
      } as unknown as Response);

      const promise = embedTexts(['hi'], config);
      vi.advanceTimersByTime(0);
      const result = await promise;
      expect(result).toBeUndefined();
    });

    it('should return undefined when embedding is empty array', async () => {
      const config = createConfig();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: [] }),
      } as unknown as Response);

      const promise = embedTexts(['hi'], config);
      vi.advanceTimersByTime(0);
      const result = await promise;
      expect(result).toBeUndefined();
    });

    it('should return undefined when response contains no embeddings fields', async () => {
      const config = createConfig();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as unknown as Response);

      const promise = embedTexts(['hi'], config);
      vi.advanceTimersByTime(0);
      const result = await promise;
      expect(result).toBeUndefined();
    });

    it('should return undefined when response is non-ok', async () => {
      const config = createConfig();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as unknown as Response);

      const promise = embedTexts(['hi'], config);
      vi.advanceTimersByTime(0);
      const result = await promise;
      expect(result).toBeUndefined();
    });

    it('should return undefined when fetch throws', async () => {
      const config = createConfig();
      mockFetch.mockRejectedValue(new Error('network error'));

      const promise = embedTexts(['hi'], config);
      vi.advanceTimersByTime(0);
      const result = await promise;
      expect(result).toBeUndefined();
    });

    it('should return undefined when json parsing throws', async () => {
      const config = createConfig();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('invalid json');
        },
      } as unknown as Response);

      const promise = embedTexts(['hi'], config);
      vi.advanceTimersByTime(0);
      const result = await promise;
      expect(result).toBeUndefined();
    });

    it('should pass AbortSignal to fetch and clear timeout on success', async () => {
      const config = createConfig();
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embeddings: [[1, 2, 3]] }),
      } as unknown as Response);

      const promise = embedTexts(['hi'], config);
      vi.advanceTimersByTime(0);
      const result = await promise;

      expect(result).toEqual([[1, 2, 3]]);
      const init = mockFetch.mock.calls[0][1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should clear timeout even when fetch throws', async () => {
      const config = createConfig();
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      mockFetch.mockRejectedValue(new Error('fail'));

      const promise = embedTexts(['hi'], config);
      vi.advanceTimersByTime(0);
      const result = await promise;

      expect(result).toBeUndefined();
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should clear timeout even when response is non-ok', async () => {
      const config = createConfig();
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      } as unknown as Response);

      const promise = embedTexts(['hi'], config);
      vi.advanceTimersByTime(0);
      const result = await promise;

      expect(result).toBeUndefined();
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should validate dimensions loosely and return embeddings even if dimensions mismatch', async () => {
      const config = createConfig({ dimensions: 4 });
      // Return embeddings with 2 dimensions instead of 4 – should still be returned
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embeddings: [[0.1, 0.2]] }),
      } as unknown as Response);

      const promise = embedTexts(['hi'], config);
      vi.advanceTimersByTime(0);
      const result = await promise;
      expect(result).toEqual([[0.1, 0.2]]);
    });

    it('should return embeddings even when some entries have mismatched dimensions', async () => {
      const config = createConfig({ dimensions: 3 });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          embeddings: [
            [0.1, 0.2, 0.3],
            [0.1, 0.2], // mismatched
          ],
        }),
      } as unknown as Response);

      const promise = embedTexts(['a', 'b'], config);
      vi.advanceTimersByTime(0);
      const result = await promise;
      expect(result).toEqual([
        [0.1, 0.2, 0.3],
        [0.1, 0.2],
      ]);
    });

    it('should return embeddings even when entries are not arrays (loose validation)', async () => {
      const config = createConfig({ dimensions: 3 });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          embeddings: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
        }),
      } as unknown as Response);

      const promise = embedTexts(['a', 'b'], config);
      vi.advanceTimersByTime(0);
      const result = await promise;
      expect(result).toEqual([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ]);
    });
  });

  describe('embedText', () => {
    const originalFetch = globalThis.fetch;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
      globalThis.fetch = originalFetch;
    });

    it('should return undefined for empty string without calling fetch', async () => {
      const config = createConfig();
      const result = await embedText('', config);
      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return undefined for whitespace only without calling fetch', async () => {
      const config = createConfig();
      const result = await embedText('   \n\t  ', config);
      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should normalize prompt and delegate to embedTexts', async () => {
      const config = createConfig();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
      } as unknown as Response);

      const promise = embedText('  Hello WORLD  ', config);
      vi.advanceTimersByTime(0);
      const result = await promise;

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const init = mockFetch.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      // embedText normalizes to lowercase + trim before delegating
      expect(body['input']).toBe('hello world');
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it('should truncate normalized text to 8000 chars before embedding', async () => {
      const config = createConfig();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embeddings: [[1, 2, 3]] }),
      } as unknown as Response);

      const long = 'A'.repeat(9000);
      const promise = embedText(long, config);
      vi.advanceTimersByTime(0);
      await promise;

      const init = mockFetch.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect((body['input'] as string).length).toBe(8000);
      expect(body['input']).toBe('a'.repeat(8000));
    });

    it('should return undefined when delegated embedTexts returns undefined (non-ok)', async () => {
      const config = createConfig();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as unknown as Response);

      const promise = embedText('hello', config);
      vi.advanceTimersByTime(0);
      const result = await promise;
      expect(result).toBeUndefined();
    });

    it('should return undefined when delegated embedTexts returns undefined (empty embeddings)', async () => {
      const config = createConfig();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embeddings: [] }),
      } as unknown as Response);

      const promise = embedText('hello', config);
      vi.advanceTimersByTime(0);
      const result = await promise;
      expect(result).toBeUndefined();
    });

    it('should handle singular embedding response correctly', async () => {
      const config = createConfig();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: [9, 8, 7] }),
      } as unknown as Response);

      const promise = embedText('hello', config);
      vi.advanceTimersByTime(0);
      const result = await promise;
      expect(result).toEqual([9, 8, 7]);
    });

    it('should handle fetch throw via delegation and return undefined', async () => {
      const config = createConfig();
      mockFetch.mockRejectedValue(new Error('network down'));

      const promise = embedText('hello', config);
      vi.advanceTimersByTime(0);
      const result = await promise;
      expect(result).toBeUndefined();
    });
  });
});
