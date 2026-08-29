import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@earendil-works/pi-coding-agent', () => ({
  getAgentDir: () => '/tmp/mock-agent-dir',
}));

// Need to re-import after mock
import { VectorStore, resolveVectorFilePath, ensureSymlinkForAgentFile } from './vector-store';
import { normalizePromptForEmbedding } from './embeddings';

describe('vector-store', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vec-test-'));
    dbPath = join(tmpDir, 'test.db');
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should initialize and report ready', () => {
    const store = new VectorStore(dbPath, 4);
    expect(store.init()).toBe(true);
    expect(store.isReady()).toBe(true);
    expect(store.stats()?.count).toBe(0);
    store.close();
  });

  it('should upsert and search with cosine similarity', () => {
    const store = new VectorStore(dbPath, 4);
    store.init();
    const emb1 = [0.1, 0.2, 0.3, 0.4];
    const emb2 = [0.1, 0.2, 0.3, 0.41]; // very similar
    const embFar = [0.9, -0.9, 0.9, -0.9];

    store.upsert('hello world', normalizePromptForEmbedding('hello world'), 'high', 'reason high', emb1);
    expect(store.stats()?.count).toBe(1);

    const hit = store.search(emb2, 1, 0.88);
    expect(hit).toBeDefined();
    expect(hit?.tier).toBe('high');
    expect(hit?.similarity).toBeGreaterThan(0.99);

    const miss = store.search(embFar, 1, 0.88);
    expect(miss).toBeUndefined();

    store.close();
  });

  it('should respect threshold', () => {
    const store = new VectorStore(dbPath, 4);
    store.init();
    const emb1 = [1, 0, 0, 0];
    const emb2 = [0.8, 0.6, 0, 0]; // cos ~0.8
    store.upsert('prompt a', normalizePromptForEmbedding('prompt a'), 'low', 'r', emb1);
    // threshold 0.9 should miss, 0.75 should hit
    expect(store.search(emb2, 1, 0.9)).toBeUndefined();
    expect(store.search(emb2, 1, 0.75)?.similarity).toBeCloseTo(0.8, 1);
    store.close();
  });

  it('should increment hit count', () => {
    const store = new VectorStore(dbPath, 4);
    store.init();
    const emb = [0.1, 0.2, 0.3, 0.4];
    store.upsert('p', normalizePromptForEmbedding('p'), 'medium', 'r', emb);
    store.incrementHit(normalizePromptForEmbedding('p'));
    const row = store.search(emb, 1, 0.5);
    expect(row?.hitCount).toBe(1);
    store.close();
  });

  it('should clear', () => {
    const store = new VectorStore(dbPath, 4);
    store.init();
    store.upsert('p1', normalizePromptForEmbedding('p1'), 'low', 'r', [0.1, 0.2, 0.3, 0.4]);
    store.upsert('p2', normalizePromptForEmbedding('p2'), 'high', 'r2', [0.4, 0.3, 0.2, 0.1]);
    expect(store.stats()?.count).toBe(2);
    expect(store.clear()).toBe(true);
    expect(store.stats()?.count).toBe(0);
    store.close();
  });

  it('resolveVectorFilePath handles relative and absolute', () => {
    expect(resolveVectorFilePath('custom.db')).toBe('/tmp/mock-agent-dir/custom.db');
    expect(resolveVectorFilePath('/absolute/path.db')).toBe('/absolute/path.db');
  });
});
