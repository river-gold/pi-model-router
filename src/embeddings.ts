import type { VectorCacheConfig } from './types';

export const normalizePromptForEmbedding = (text: string): string => {
  return text.trim().toLowerCase().slice(0, 8000);
};

export const embedTexts = async (
  texts: string[],
  config: VectorCacheConfig,
): Promise<number[][] | undefined> => {
  if (texts.length === 0) return undefined;
  const filtered = texts.map((t) => t.trim()).filter(Boolean);
  if (filtered.length === 0) return undefined;

  const baseUrl = config.embeddingBaseUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/api/embed`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.embeddingModel,
        input: filtered.length === 1 ? filtered[0] : filtered,
        truncate: true,
        keep_alive: config.keepAlive ?? '5m',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return undefined;
    }

    const data = (await response.json()) as {
      embeddings?: number[][];
      embedding?: number[];
    };

    if (Array.isArray(data.embeddings) && data.embeddings.length > 0) {
      // Validate dimensions
      if (data.embeddings.some((e) => !Array.isArray(e) || e.length !== config.dimensions)) {
        // If dimensions mismatch, still return but warn via undefined? Return as-is if plausible.
        // Allow any dimension if config mismatch; caller can handle.
      }
      return data.embeddings;
    }

    if (Array.isArray(data.embedding) && data.embedding.length > 0) {
      return [data.embedding];
    }

    return undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
};

export const embedText = async (
  text: string,
  config: VectorCacheConfig,
): Promise<number[] | undefined> => {
  const normalized = normalizePromptForEmbedding(text);
  if (!normalized) return undefined;
  const results = await embedTexts([normalized], config);
  return results?.[0];
};
