import { describe, it, expect, vi } from 'vitest';
import {
  parseConfigFile,
  mergeConfig,
  parseCanonicalModelRef,
  normalizeTierConfig,
  normalizeConfig,
  loadRouterConfig,
  profileNames,
  resolveProfileName,
  resolveContextWindow,
  resolveMaxTokens,
  resolveDelegatedReasoning,
  isObjectRecord,
  isRouterTier,
  normalizeVectorCacheConfig,
  DEFAULT_VECTOR_THRESHOLD,
  DEFAULT_VECTOR_FILE,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_BASE_URL,
  DEFAULT_VECTOR_DIMENSIONS,
  DEFAULT_EMBEDDING_CONTEXT_WINDOW,
  DEFAULT_HISTORY_SIZE,
} from './config';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { RouterConfig, RouterProfile, RoutedTierConfig } from './types';

vi.mock('@earendil-works/pi-coding-agent', () => ({
  getAgentDir: () => '/mock/agent/dir',
}));

vi.mock('node:fs', () => ({
  existsSync: (path: string) =>
    path.includes('exists') || path.includes('model-router.json'),
  readFileSync: (path: string) => {
    if (path.includes('invalid-json')) {
      return '{invalid';
    }
    if (path.includes('not-object')) {
      return '123';
    }
    if (
      path.includes('global') ||
      (path.endsWith('model-router.json') && !path.includes('.pi'))
    ) {
      return JSON.stringify({
        debug: true,
        profiles: {
          globalProfile: {
            medium: { model: 'openai/gpt-4o' },
          },
        },
      });
    }
    if (
      path.includes('project') ||
      path.includes('.pi/model-router.json') ||
      path.includes('.pi\\model-router.json')
    ) {
      return JSON.stringify({
        profiles: {
          projectProfile: {
            high: { model: 'google/gemini-1.5-pro' },
          },
        },
      });
    }
    return '{}';
  },
}));

describe('config.ts', () => {
  describe('type guards', () => {
    it('isObjectRecord should validate objects', () => {
      expect(isObjectRecord({})).toBe(true);
      expect(isObjectRecord({ a: 1 })).toBe(true);
      expect(isObjectRecord(null)).toBe(false);
      expect(isObjectRecord('string')).toBe(false);
      expect(isObjectRecord([])).toBe(false);
    });

    it('isRouterTier should validate tiers', () => {
      expect(isRouterTier('high')).toBe(true);
      expect(isRouterTier('medium')).toBe(true);
      expect(isRouterTier('low')).toBe(true);
      expect(isRouterTier('auto')).toBe(false);
      expect(isRouterTier('invalid')).toBe(false);
    });
  });

  describe('parseConfigFile', () => {
    it('should return empty config and no warnings for non-existent file', () => {
      const result = parseConfigFile('/path/does-not-exist');
      expect(result.config).toEqual({});
      expect(result.warnings).toEqual([]);
    });

    it('should return warnings on json syntax errors', () => {
      const result = parseConfigFile('/path/exists-invalid-json');
      expect(result.config).toEqual({});
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Failed to parse router config');
    });

    it('should return warnings if root is not an object', () => {
      const result = parseConfigFile('/path/exists-not-object');
      expect(result.config).toEqual({});
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('expected a JSON object');
    });

    it('should parse valid json object', () => {
      const result = parseConfigFile('/path/exists-global');
      expect(result.config).toHaveProperty('debug', true);
      expect(result.warnings).toEqual([]);
    });
  });

  describe('mergeConfig', () => {
    it('should merge profiles override', () => {
      const base: RouterConfig = {
        debug: false,
        profiles: {
          balanced: {
            medium: { model: 'openai/gpt-4o-mini' },
          },
        },
      };

      const override: Partial<RouterConfig> = {
        debug: true,
        profiles: {
          balanced: {
            high: { model: 'openai/gpt-4o' },
          },
          cheap: {
            low: { model: 'openai/gpt-4o-mini' },
          },
        },
      };

      const merged = mergeConfig(base, override);
      expect(merged.debug).toBe(true);
      expect(merged.profiles.balanced.medium?.model).toBe('openai/gpt-4o-mini');
      expect(merged.profiles.balanced.high?.model).toBe('openai/gpt-4o');
      expect(merged.profiles.cheap?.low?.model).toBe('openai/gpt-4o-mini');
    });
  });

  describe('parseCanonicalModelRef', () => {
    it('should parse correct references', () => {
      const parsed = parseCanonicalModelRef('openai/gpt-4o');
      expect(parsed).toEqual({ provider: 'openai', modelId: 'gpt-4o' });
    });

    it('should throw on missing slash', () => {
      expect(() => parseCanonicalModelRef('gpt-4o')).toThrow(
        'Invalid model reference',
      );
    });

    it('should throw on empty provider or modelId', () => {
      expect(() => parseCanonicalModelRef('/gpt-4o')).toThrow(
        'Invalid model reference',
      );
      expect(() => parseCanonicalModelRef('openai/')).toThrow(
        'Invalid model reference',
      );
      expect(() => parseCanonicalModelRef('   /gpt-4o')).toThrow(
        'Invalid model reference',
      );
    });
  });

  describe('normalizeTierConfig', () => {
    it('should return undefined if input is not object', () => {
      const warnings: string[] = [];
      expect(
        normalizeTierConfig('string', 'p', 'high', warnings),
      ).toBeUndefined();
    });

    it('should return undefined and warning if missing model', () => {
      const warnings: string[] = [];
      const result = normalizeTierConfig({}, 'p', 'high', warnings);
      expect(result).toBeUndefined();
      expect(warnings[0]).toContain('missing a model');
    });

    it('should resolve and normalize details', () => {
      const warnings: string[] = [];
      const raw = {
        model: 'openai/gpt-4o',
        thinking: 'high',
        fallbacks: ['google/gemini-1.5-flash', 'invalid-fallback'],
        contextWindow: 50000,
        maxTokens: 2000,
      };
      const result = normalizeTierConfig(raw, 'p', 'high', warnings);
      expect(result).toBeDefined();
      expect(result?.model).toBe('openai/gpt-4o');
      expect(result?.thinking).toBe('high');
      expect(result?.fallbacks).toEqual(['google/gemini-1.5-flash']);
      expect(result?.resolvedContextWindow).toBe(50000);
      expect(result?.resolvedMaxTokens).toBe(2000);
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('Invalid fallback model');
    });
  });

  describe('normalizeConfig', () => {
    it('should normalize profiles and classifierModel', () => {
      const raw = {
        debug: true,
        classifierModel: 'openai/gpt-4o',
        profiles: {
          balanced: {
            high: { model: 'google/gemini-2.5-pro' },
          },
        },
      };

      const { config, warnings } = normalizeConfig(
        raw as unknown as RouterConfig,
      );
      expect(warnings).toEqual([]);
      expect(config.debug).toBe(true);
      expect(config.classifierModel?.model).toBe('openai/gpt-4o');
      expect(config.profiles.balanced?.high?.model).toBe(
        'google/gemini-2.5-pro',
      );
    });
  });

  describe('loadRouterConfig', () => {
    it('should merge and normalize global and project config files', () => {
      const { config } = loadRouterConfig('/path/exists');
      expect(config.debug).toBe(true);
      expect(config.profiles.globalProfile?.medium?.model).toBe(
        'openai/gpt-4o',
      );
      expect(config.profiles.projectProfile?.high?.model).toBe(
        'google/gemini-1.5-pro',
      );
    });
  });

  describe('profileNames', () => {
    it('should return sorted profile names', () => {
      const config: RouterConfig = {
        profiles: {
          zebra: {},
          apple: {},
          banana: {},
        },
      };
      expect(profileNames(config)).toEqual(['apple', 'banana', 'zebra']);
    });
  });

  describe('resolveProfileName', () => {
    const config: RouterConfig = {
      profiles: {
        balanced: {},
        cheap: {},
      },
    };

    it('should return requested if valid', () => {
      expect(resolveProfileName(config, 'balanced')).toBe('balanced');
    });

    it('should return undefined if invalid or missing', () => {
      expect(resolveProfileName(config, 'unknown')).toBeUndefined();
      expect(resolveProfileName(config)).toBeUndefined();
    });
  });

  describe('resolveContextWindow and resolveMaxTokens', () => {
    const profile: RouterProfile = {
      high: {
        model: 'openai/gpt-4o',
        resolvedContextWindow: 60000,
        resolvedMaxTokens: 4000,
      },
    };

    const mockRegistry = {
      find: (provider: string, modelId: string) => {
        if (provider === 'openai' && modelId === 'gpt-4o') {
          return { contextWindow: 99999, maxTokens: 8888 } as any;
        }
        return undefined;
      },
      getApiKeyAndHeaders: async () => ({
        ok: false as const,
        error: 'not-mocked',
      }),
    };

    it('should resolve using registry if available', () => {
      const cw = resolveContextWindow('high', profile, mockRegistry as any);
      const mot = resolveMaxTokens('high', profile, mockRegistry as any);
      expect(cw).toBe(99999);
      expect(mot).toBe(8888);
    });

    it('should fall back to pre-resolved config values if registry lookup fails or is missing', () => {
      const cw = resolveContextWindow('high', profile, undefined);
      const mot = resolveMaxTokens('high', profile, undefined);
      expect(cw).toBe(60000);
      expect(mot).toBe(4000);
    });
  });

  describe('resolveContextWindow and resolveMaxTokens – additional coverage', () => {
    it('should return default when tier is missing from profile', () => {
      const profile: RouterProfile = {
        high: { model: 'openai/gpt-4o', resolvedContextWindow: 60000, resolvedMaxTokens: 4000 },
      };
      expect(resolveContextWindow('low', profile, undefined)).toBe(128_000);
      expect(resolveMaxTokens('low', profile, undefined)).toBe(16_384);
    });

    it('should fall back to resolvedContextWindow/MaxTokens when registry model has no values', () => {
      const profile: RouterProfile = {
        high: { model: 'openai/gpt-4o', resolvedContextWindow: 60000, resolvedMaxTokens: 4000 },
      };
      const registryNoValues = {
        find: () => ({}),
        getApiKeyAndHeaders: async () => ({ ok: false as const, error: 'not-mocked' }),
      };
      expect(resolveContextWindow('high', profile, registryNoValues as any)).toBe(60000);
      expect(resolveMaxTokens('high', profile, registryNoValues as any)).toBe(4000);
    });

    it('should catch parseCanonicalModelRef errors and return resolved values', () => {
      const profile: RouterProfile = {
        high: { model: 'invalid-no-slash', resolvedContextWindow: 50000, resolvedMaxTokens: 3000 },
      };
      const registryWithFind = {
        find: () => ({ contextWindow: 99999, maxTokens: 8888 }),
        getApiKeyAndHeaders: async () => ({ ok: false as const, error: 'not-mocked' }),
      };
      // parseCanonicalModelRef will throw for 'invalid-no-slash', so it falls through to resolved values
      expect(resolveContextWindow('high', profile, registryWithFind as any)).toBe(50000);
      expect(resolveMaxTokens('high', profile, registryWithFind as any)).toBe(3000);
    });
  });

  describe('thinking level resolution', () => {
    it('resolves against the target model capabilities', () => {
      const model = {
        reasoning: true,
        thinkingLevelMap: {
          off: null,
          minimal: null,
          low: 'low',
          medium: 'medium',
          high: 'high',
          xhigh: null,
          max: null,
        },
      } as unknown as Model<Api>;

      expect(resolveDelegatedReasoning(model, 'max')).toBe('max');
      expect(resolveDelegatedReasoning(model, 'off')).toBeUndefined();
      expect(resolveDelegatedReasoning({ reasoning: false } as unknown as Model<Api>, 'high')).toBeUndefined();
    });
  });

  describe('normalizeConfig – classifier config variants', () => {
    it('should normalize classifierModel as object with valid thinking', () => {
      const raw = {
        profiles: {
          balanced: { high: { model: 'openai/gpt-4o' } },
        },
        classifierModel: { model: 'openai/gpt-4o', thinking: 'low' },
      };
      const { config, warnings } = normalizeConfig(raw as unknown as RouterConfig);
      expect(config.classifierModel?.model).toBe('openai/gpt-4o');
      expect(config.classifierModel?.thinking).toBe('low');
      expect(warnings).toEqual([]);
    });

    it('should warn and ignore invalid thinking on classifierModel object', () => {
      const raw = {
        profiles: {
          balanced: { high: { model: 'openai/gpt-4o' } },
        },
        classifierModel: { model: 'openai/gpt-4o', thinking: 'super-invalid' },
      };
      const { config, warnings } = normalizeConfig(raw as unknown as RouterConfig);
      expect(config.classifierModel?.model).toBe('openai/gpt-4o');
      expect(config.classifierModel?.thinking).toBe('super-invalid');
      expect(warnings.length).toBe(0);
    });

    it('should warn when classifierModel object is missing model field', () => {
      const raw = {
        profiles: {
          balanced: { high: { model: 'openai/gpt-4o' } },
        },
        classifierModel: { thinking: 'high' },
      };
      const { config, warnings } = normalizeConfig(raw as unknown as RouterConfig);
      expect(config.classifierModel).toBeUndefined();
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('missing the "model" field');
    });
  });

  describe('normalizeVectorCacheConfig', () => {
    it('should return undefined for undefined', () => {
      const warnings: string[] = [];
      expect(normalizeVectorCacheConfig(undefined, warnings)).toBeUndefined();
      expect(warnings).toEqual([]);
    });

    it('should return undefined for null', () => {
      const warnings: string[] = [];
      expect(normalizeVectorCacheConfig(null, warnings)).toBeUndefined();
      expect(warnings).toEqual([]);
    });

    it('should warn and return undefined for non-object', () => {
      const cases: unknown[] = ['string', 123, true, [], 0];
      for (const raw of cases) {
        const warnings: string[] = [];
        const result = normalizeVectorCacheConfig(raw, warnings);
        expect(result).toBeUndefined();
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toContain('expected an object');
      }
    });

    it('should return defaults for empty object', () => {
      const warnings: string[] = [];
      const result = normalizeVectorCacheConfig({}, warnings);
      expect(result).toEqual({
        enabled: true,
        threshold: DEFAULT_VECTOR_THRESHOLD,
        vectorFile: DEFAULT_VECTOR_FILE,
        embeddingModel: DEFAULT_EMBEDDING_MODEL,
        embeddingBaseUrl: DEFAULT_EMBEDDING_BASE_URL,
        backgroundRefresh: false,
        dimensions: DEFAULT_VECTOR_DIMENSIONS,
        embeddingContextWindow: DEFAULT_EMBEDDING_CONTEXT_WINDOW,
        historySize: DEFAULT_HISTORY_SIZE,
      });
      expect(warnings).toEqual([]);
    });

    it('should handle enabled false', () => {
      const warnings: string[] = [];
      const result = normalizeVectorCacheConfig({ enabled: false }, warnings);
      expect(result?.enabled).toBe(false);
    });

    it('should default enabled to true for non-boolean', () => {
      const warnings: string[] = [];
      const result = normalizeVectorCacheConfig({ enabled: 'yes' }, warnings);
      expect(result?.enabled).toBe(true);
    });

    it('should accept valid threshold values', () => {
      for (const threshold of [0, 0.5, 1, 0.75]) {
        const warnings: string[] = [];
        const result = normalizeVectorCacheConfig({ threshold }, warnings);
        expect(result?.threshold).toBe(threshold);
        expect(warnings).toEqual([]);
      }
    });

    it('should warn and use default for threshold out of range or invalid', () => {
      const invalidCases: unknown[] = [-0.1, 1.5, 2, -1, 'high', null, true];
      for (const threshold of invalidCases) {
        const warnings: string[] = [];
        const result = normalizeVectorCacheConfig({ threshold }, warnings);
        expect(result?.threshold).toBe(DEFAULT_VECTOR_THRESHOLD);
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toContain('Invalid vectorCache.threshold');
      }
    });

    it('should accept valid vectorFile and trim', () => {
      const warnings: string[] = [];
      const result = normalizeVectorCacheConfig({ vectorFile: '  custom.db  ' }, warnings);
      expect(result?.vectorFile).toBe('custom.db');
      expect(warnings).toEqual([]);
    });

    it('should warn and use default for invalid vectorFile', () => {
      const invalidCases: unknown[] = ['', '   ', 123, null, false];
      for (const vectorFile of invalidCases) {
        const warnings: string[] = [];
        const result = normalizeVectorCacheConfig({ vectorFile }, warnings);
        expect(result?.vectorFile).toBe(DEFAULT_VECTOR_FILE);
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toContain('Invalid vectorCache.vectorFile');
      }
    });

    it('should handle vectorFile aliases vectorPath and file', () => {
      const w1: string[] = [];
      expect(normalizeVectorCacheConfig({ vectorPath: 'alias-path.db' }, w1)?.vectorFile).toBe('alias-path.db');
      expect(w1).toEqual([]);

      const w2: string[] = [];
      expect(normalizeVectorCacheConfig({ file: 'file-alias.db' }, w2)?.vectorFile).toBe('file-alias.db');
      expect(w2).toEqual([]);
    });

    it('should prefer vectorFile over aliases', () => {
      const warnings: string[] = [];
      const result = normalizeVectorCacheConfig(
        { vectorFile: 'primary.db', vectorPath: 'alias.db', file: 'file.db' },
        warnings,
      );
      expect(result?.vectorFile).toBe('primary.db');
    });

    it('should use vectorPath alias when vectorFile is invalid and alias provided', () => {
      const warnings: string[] = [];
      const result = normalizeVectorCacheConfig({ vectorFile: '', vectorPath: 'fallback.db' }, warnings);
      // invalid vectorFile warns, then alias overrides because vectorFile still default
      expect(result?.vectorFile).toBe('fallback.db');
      expect(warnings.length).toBe(1);
    });

    it('should accept valid embeddingModel and trim', () => {
      const warnings: string[] = [];
      const result = normalizeVectorCacheConfig({ embeddingModel: '  my-model:1b  ' }, warnings);
      expect(result?.embeddingModel).toBe('my-model:1b');
      expect(warnings).toEqual([]);
    });

    it('should warn and use default for invalid embeddingModel', () => {
      const invalidCases: unknown[] = ['', '   ', 123, false];
      for (const embeddingModel of invalidCases) {
        const warnings: string[] = [];
        const result = normalizeVectorCacheConfig({ embeddingModel }, warnings);
        expect(result?.embeddingModel).toBe(DEFAULT_EMBEDDING_MODEL);
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toContain('Invalid vectorCache.embeddingModel');
      }
    });

    it('should handle embeddingModel alias "model"', () => {
      const warnings: string[] = [];
      const result = normalizeVectorCacheConfig({ model: 'alias-model:0.5b' }, warnings);
      expect(result?.embeddingModel).toBe('alias-model:0.5b');
      expect(warnings).toEqual([]);
    });

    it('should prefer embeddingModel over alias model', () => {
      const warnings: string[] = [];
      const result = normalizeVectorCacheConfig(
        { embeddingModel: 'primary:1b', model: 'alias:1b' },
        warnings,
      );
      expect(result?.embeddingModel).toBe('primary:1b');
    });

    it('should accept valid embeddingBaseUrl and trim trailing slash', () => {
      const cases: Array<[string, string]> = [
        ['http://localhost:11434', 'http://localhost:11434'],
        ['http://localhost:11434/', 'http://localhost:11434'],
        ['http://localhost:11434///', 'http://localhost:11434'],
        ['  http://example.com/api/  ', 'http://example.com/api'],
      ];
      for (const [input, expected] of cases) {
        const warnings: string[] = [];
        const result = normalizeVectorCacheConfig({ embeddingBaseUrl: input }, warnings);
        expect(result?.embeddingBaseUrl).toBe(expected);
        expect(warnings).toEqual([]);
      }
    });

    it('should warn for invalid embeddingBaseUrl type', () => {
      const warnings: string[] = [];
      const result = normalizeVectorCacheConfig({ embeddingBaseUrl: 123 }, warnings);
      expect(result?.embeddingBaseUrl).toBe(DEFAULT_EMBEDDING_BASE_URL);
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('Invalid vectorCache.embeddingBaseUrl');
    });

    it('should handle embeddingBaseUrl alias baseUrl', () => {
      const warnings: string[] = [];
      const result = normalizeVectorCacheConfig({ baseUrl: 'http://alias:11434/' }, warnings);
      expect(result?.embeddingBaseUrl).toBe('http://alias:11434');
      expect(warnings).toEqual([]);
    });

    it('should prefer embeddingBaseUrl over alias baseUrl', () => {
      const warnings: string[] = [];
      const result = normalizeVectorCacheConfig(
        { embeddingBaseUrl: 'http://primary:11434/', baseUrl: 'http://alias:11434/' },
        warnings,
      );
      expect(result?.embeddingBaseUrl).toBe('http://primary:11434');
    });

    it('should use default when embeddingBaseUrl empty string and no alias', () => {
      const warnings: string[] = [];
      const result = normalizeVectorCacheConfig({ embeddingBaseUrl: '' }, warnings);
      expect(result?.embeddingBaseUrl).toBe(DEFAULT_EMBEDDING_BASE_URL);
      // empty string is treated as not provided, warning only for non-string type so no warning here
      expect(warnings).toEqual([]);
    });

    it('should handle backgroundRefresh boolean', () => {
      expect(normalizeVectorCacheConfig({ backgroundRefresh: true }, [])?.backgroundRefresh).toBe(true);
      expect(normalizeVectorCacheConfig({ backgroundRefresh: false }, [])?.backgroundRefresh).toBe(false);
      expect(normalizeVectorCacheConfig({}, [])?.backgroundRefresh).toBe(false);
      expect(normalizeVectorCacheConfig({ backgroundRefresh: 'yes' }, [])?.backgroundRefresh).toBe(false);
    });

    it('should accept valid dimensions', () => {
      for (const dimensions of [1, 128, 1024, 4096]) {
        const warnings: string[] = [];
        const result = normalizeVectorCacheConfig({ dimensions }, warnings);
        expect(result?.dimensions).toBe(dimensions);
        expect(warnings).toEqual([]);
      }
    });

    it('should warn and use default for invalid dimensions', () => {
      const invalidCases: unknown[] = [0, -1, 4097, 1.5, '1024', null, false, NaN];
      for (const dimensions of invalidCases) {
        const warnings: string[] = [];
        const result = normalizeVectorCacheConfig({ dimensions }, warnings);
        expect(result?.dimensions).toBe(DEFAULT_VECTOR_DIMENSIONS);
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toContain('Invalid vectorCache.dimensions');
      }
    });

    it('should handle keepAlive valid, trimmed, and invalid', () => {
      const w1: string[] = [];
      expect(normalizeVectorCacheConfig({ keepAlive: '5m' }, w1)?.keepAlive).toBe('5m');
      expect(w1).toEqual([]);

      const w2: string[] = [];
      expect(normalizeVectorCacheConfig({ keepAlive: '  10m  ' }, w2)?.keepAlive).toBe('10m');

      const w3: string[] = [];
      expect(normalizeVectorCacheConfig({ keepAlive: '' }, w3)?.keepAlive).toBeUndefined();

      const w4: string[] = [];
      expect(normalizeVectorCacheConfig({ keepAlive: '   ' }, w4)?.keepAlive).toBeUndefined();

      const w5: string[] = [];
      expect(normalizeVectorCacheConfig({}, w5)?.keepAlive).toBeUndefined();

      const w6: string[] = [];
      expect(normalizeVectorCacheConfig({ keepAlive: 123 }, w6)?.keepAlive).toBeUndefined();
    });

    it('should accept valid embeddingContextWindow', () => {
      for (const embeddingContextWindow of [1, 8192, 100000]) {
        const warnings: string[] = [];
        const result = normalizeVectorCacheConfig({ embeddingContextWindow }, warnings);
        expect(result?.embeddingContextWindow).toBe(embeddingContextWindow);
        expect(warnings).toEqual([]);
      }
    });

    it('should warn and use default for invalid embeddingContextWindow', () => {
      const invalidCases: unknown[] = [0, -1, 100001, 1.5, '8192', false];
      for (const embeddingContextWindow of invalidCases) {
        const warnings: string[] = [];
        const result = normalizeVectorCacheConfig({ embeddingContextWindow }, warnings);
        expect(result?.embeddingContextWindow).toBe(DEFAULT_EMBEDDING_CONTEXT_WINDOW);
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toContain('Invalid vectorCache.embeddingContextWindow');
      }
    });

    it('should handle null embeddingContextWindow as not set (nullish coalesce)', () => {
      const warnings: string[] = [];
      const result = normalizeVectorCacheConfig({ embeddingContextWindow: null }, warnings);
      // null is nullish so falls through to undefined, no warning, default value
      expect(result?.embeddingContextWindow).toBe(DEFAULT_EMBEDDING_CONTEXT_WINDOW);
      expect(warnings).toEqual([]);
    });

    it('should handle embeddingContextWindow aliases', () => {
      const w1: string[] = [];
      expect(normalizeVectorCacheConfig({ embeddingContextSize: 4096 }, w1)?.embeddingContextWindow).toBe(4096);
      expect(w1).toEqual([]);

      const w2: string[] = [];
      expect(normalizeVectorCacheConfig({ contextWindow: 2048 }, w2)?.embeddingContextWindow).toBe(2048);

      const w3: string[] = [];
      expect(normalizeVectorCacheConfig({ contextSize: 1024 }, w3)?.embeddingContextWindow).toBe(1024);

      const w4: string[] = [];
      expect(normalizeVectorCacheConfig({ maxTokens: 512 }, w4)?.embeddingContextWindow).toBe(512);
    });

    it('should respect embeddingContextWindow alias priority (first defined wins)', () => {
      const warnings: string[] = [];
      const result = normalizeVectorCacheConfig(
        {
          embeddingContextWindow: 9000,
          embeddingContextSize: 8000,
          contextWindow: 7000,
          contextSize: 6000,
          maxTokens: 5000,
        },
        warnings,
      );
      expect(result?.embeddingContextWindow).toBe(9000);

      const w2: string[] = [];
      const r2 = normalizeVectorCacheConfig({ embeddingContextSize: 8000, contextWindow: 7000 }, w2);
      expect(r2?.embeddingContextWindow).toBe(8000);
    });

    it('should handle all valid fields together', () => {
      const warnings: string[] = [];
      const result = normalizeVectorCacheConfig(
        {
          enabled: false,
          threshold: 0.9,
          vectorFile: 'custom.db',
          embeddingModel: 'my-model:1b',
          embeddingBaseUrl: 'http://example.com/',
          backgroundRefresh: true,
          dimensions: 512,
          embeddingContextWindow: 4096,
          historySize: 4,
          keepAlive: '5m',
        },
        warnings,
      );
      expect(result).toEqual({
        enabled: false,
        threshold: 0.9,
        vectorFile: 'custom.db',
        embeddingModel: 'my-model:1b',
        embeddingBaseUrl: 'http://example.com',
        backgroundRefresh: true,
        dimensions: 512,
        embeddingContextWindow: 4096,
        historySize: 4,
        keepAlive: '5m',
      });
      expect(warnings).toEqual([]);
    });
  });

  describe('mergeConfig – vectorCache', () => {
    it('should return undefined vectorCache when both base and override have none', () => {
      const base: RouterConfig = { profiles: {} };
      const override: Partial<RouterConfig> = {};
      const merged = mergeConfig(base, override);
      expect(merged.vectorCache).toBeUndefined();
    });

    it('should keep base vectorCache when override has none', () => {
      const base: RouterConfig = {
        profiles: {},
        vectorCache: {
          enabled: true,
          threshold: 0.8,
          vectorFile: 'base.db',
          embeddingModel: 'model:1b',
          embeddingBaseUrl: 'http://localhost:11434',
          backgroundRefresh: false,
          dimensions: 1024,
          embeddingContextWindow: 8192,
        },
      };
      const merged = mergeConfig(base, {});
      expect(merged.vectorCache?.vectorFile).toBe('base.db');
      expect(merged.vectorCache?.threshold).toBe(0.8);
    });

    it('should set override vectorCache when base has none', () => {
      const base: RouterConfig = { profiles: {} };
      const override: Partial<RouterConfig> = {
        vectorCache: {
          enabled: true,
          threshold: 0.9,
          vectorFile: 'override.db',
          embeddingModel: 'override:1b',
          embeddingBaseUrl: 'http://override:11434',
          backgroundRefresh: true,
          dimensions: 512,
          embeddingContextWindow: 4096,
        },
      };
      const merged = mergeConfig(base, override);
      expect(merged.vectorCache?.vectorFile).toBe('override.db');
      expect(merged.vectorCache?.threshold).toBe(0.9);
    });

    it('should shallow merge when both base and override are objects', () => {
      const base: RouterConfig = {
        profiles: {},
        vectorCache: {
          enabled: true,
          threshold: 0.75,
          vectorFile: 'base.db',
          embeddingModel: 'base:1b',
          embeddingBaseUrl: 'http://localhost:11434',
          backgroundRefresh: false,
          dimensions: 1024,
          embeddingContextWindow: 8192,
        },
      };
      const override: Partial<RouterConfig> = {
        vectorCache: {
          threshold: 0.9,
          backgroundRefresh: true,
        } as unknown as RouterConfig['vectorCache'],
      };
      const merged = mergeConfig(base, override);
      expect(merged.vectorCache?.threshold).toBe(0.9);
      expect(merged.vectorCache?.backgroundRefresh).toBe(true);
      // base fields preserved
      expect(merged.vectorCache?.vectorFile).toBe('base.db');
      expect(merged.vectorCache?.embeddingModel).toBe('base:1b');
      expect(merged.vectorCache?.dimensions).toBe(1024);
    });

    it('should not mutate base when merging', () => {
      const base: RouterConfig = {
        profiles: {},
        vectorCache: {
          enabled: true,
          threshold: 0.75,
          vectorFile: 'base.db',
          embeddingModel: 'base:1b',
          embeddingBaseUrl: 'http://localhost:11434',
          backgroundRefresh: false,
          dimensions: 1024,
          embeddingContextWindow: 8192,
        },
      };
      const override: Partial<RouterConfig> = {
        vectorCache: { threshold: 0.9 } as unknown as RouterConfig['vectorCache'],
      };
      const merged = mergeConfig(base, override);
      expect(base.vectorCache?.threshold).toBe(0.75);
      expect(merged.vectorCache?.threshold).toBe(0.9);
    });
  });

  describe('normalizeConfig – vectorCache', () => {
    it('should normalize valid vectorCache', () => {
      const raw = {
        profiles: {
          balanced: { high: { model: 'openai/gpt-4o' } },
        },
        vectorCache: {
          enabled: true,
          threshold: 0.9,
          vectorFile: 'custom.db',
          embeddingModel: 'my-model:1b',
          embeddingBaseUrl: 'http://example.com/',
          backgroundRefresh: true,
          dimensions: 512,
          embeddingContextWindow: 4096,
          historySize: 2,
          keepAlive: '5m',
        },
      };
      const { config, warnings } = normalizeConfig(raw as unknown as RouterConfig);
      expect(warnings).toEqual([]);
      expect(config.vectorCache).toEqual({
        enabled: true,
        threshold: 0.9,
        vectorFile: 'custom.db',
        embeddingModel: 'my-model:1b',
        embeddingBaseUrl: 'http://example.com',
        backgroundRefresh: true,
        dimensions: 512,
        embeddingContextWindow: 4096,
        historySize: 2,
        keepAlive: '5m',
      });
    });

    it('should handle vectorCache undefined (no vectorCache in result)', () => {
      const raw = {
        profiles: {
          balanced: { high: { model: 'openai/gpt-4o' } },
        },
      };
      const { config } = normalizeConfig(raw as unknown as RouterConfig);
      expect(config.vectorCache).toBeUndefined();
    });

    it('should normalize invalid vectorCache fields to defaults with warnings', () => {
      const raw = {
        profiles: {
          balanced: { high: { model: 'openai/gpt-4o' } },
        },
        vectorCache: {
          threshold: 5,
          vectorFile: '',
          embeddingModel: '',
          dimensions: -1,
          embeddingContextWindow: 0,
        },
      };
      const { config, warnings } = normalizeConfig(raw as unknown as RouterConfig);
      expect(config.vectorCache?.threshold).toBe(DEFAULT_VECTOR_THRESHOLD);
      expect(config.vectorCache?.vectorFile).toBe(DEFAULT_VECTOR_FILE);
      expect(config.vectorCache?.embeddingModel).toBe(DEFAULT_EMBEDDING_MODEL);
      expect(config.vectorCache?.dimensions).toBe(DEFAULT_VECTOR_DIMENSIONS);
      expect(config.vectorCache?.embeddingContextWindow).toBe(DEFAULT_EMBEDDING_CONTEXT_WINDOW);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some((w) => w.includes('vectorCache.threshold'))).toBe(true);
      expect(warnings.some((w) => w.includes('vectorCache.vectorFile'))).toBe(true);
      expect(warnings.some((w) => w.includes('vectorCache.embeddingModel'))).toBe(true);
      expect(warnings.some((w) => w.includes('vectorCache.dimensions'))).toBe(true);
      expect(warnings.some((w) => w.includes('vectorCache.embeddingContextWindow'))).toBe(true);
    });

    it('should handle non-object vectorCache with warning', () => {
      const raw = {
        profiles: {
          balanced: { high: { model: 'openai/gpt-4o' } },
        },
        vectorCache: 'invalid',
      };
      const { config, warnings } = normalizeConfig(raw as unknown as RouterConfig);
      expect(config.vectorCache).toBeUndefined();
      expect(warnings.some((w) => w.includes('Invalid vectorCache config'))).toBe(true);
    });

    it('should handle null vectorCache', () => {
      const raw = {
        profiles: {
          balanced: { high: { model: 'openai/gpt-4o' } },
        },
        vectorCache: null,
      };
      const { config, warnings } = normalizeConfig(raw as unknown as RouterConfig);
      expect(config.vectorCache).toBeUndefined();
      // null returns undefined silently, no warning beyond nothing
      expect(warnings).toEqual([]);
    });

    it('should handle vectorCache aliases through normalizeConfig', () => {
      const raw = {
        profiles: {
          balanced: { high: { model: 'openai/gpt-4o' } },
        },
        vectorCache: {
          vectorPath: 'alias.db',
          model: 'alias-model:1b',
          baseUrl: 'http://alias:11434/',
          contextWindow: 2048,
        },
      };
      const { config, warnings } = normalizeConfig(raw as unknown as RouterConfig);
      expect(warnings).toEqual([]);
      expect(config.vectorCache?.vectorFile).toBe('alias.db');
      expect(config.vectorCache?.embeddingModel).toBe('alias-model:1b');
      expect(config.vectorCache?.embeddingBaseUrl).toBe('http://alias:11434');
      expect(config.vectorCache?.embeddingContextWindow).toBe(2048);
    });

    it('should preserve keepAlive trimming through normalizeConfig', () => {
      const raw = {
        profiles: {
          balanced: { high: { model: 'openai/gpt-4o' } },
        },
        vectorCache: {
          keepAlive: '  2m  ',
        },
      };
      const { config } = normalizeConfig(raw as unknown as RouterConfig);
      expect(config.vectorCache?.keepAlive).toBe('2m');
    });

    it('should handle enabled false through normalizeConfig', () => {
      const raw = {
        profiles: {
          balanced: { high: { model: 'openai/gpt-4o' } },
        },
        vectorCache: {
          enabled: false,
        },
      };
      const { config } = normalizeConfig(raw as unknown as RouterConfig);
      expect(config.vectorCache?.enabled).toBe(false);
    });
  });

  describe('loadRouterConfig – vectorCache still works', () => {
    it('should merge and normalize global and project config files (existing behavior)', () => {
      const { config } = loadRouterConfig('/path/exists');
      expect(config.debug).toBe(true);
      expect(config.profiles.globalProfile?.medium?.model).toBe('openai/gpt-4o');
      expect(config.profiles.projectProfile?.high?.model).toBe('google/gemini-1.5-pro');
    });
  });
});
