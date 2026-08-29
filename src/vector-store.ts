import { existsSync, lstatSync, readlinkSync, symlinkSync, unlinkSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import type { RouterTier, VectorSearchResult } from './types';

// Lazy-loaded modules to allow graceful fallback when native deps unavailable
let DatabaseCtor: typeof import('better-sqlite3') | undefined;
let sqliteVecLoad: ((db: unknown) => void) | undefined;
let loadAttempted = false;

const tryLoadNativeDeps = (): boolean => {
  if (loadAttempted) return !!DatabaseCtor && !!sqliteVecLoad;
  loadAttempted = true;
  try {
    // top-level static import preferred, but dynamic here to allow fallback when native build missing
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const betterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqliteVec = require('sqlite-vec') as { load: (db: unknown) => void };
    DatabaseCtor = betterSqlite3;
    sqliteVecLoad = sqliteVec.load;
    return true;
  } catch {
    return false;
  }
};

const REPO_AGENT_DIR = '/Users/younwoo/repo/aiai/pi/agent';

export const resolveVectorFilePath = (vectorFile: string): string => {
  const raw = vectorFile.trim();
  if (!raw) return join(getAgentDir(), 'router-vectors.db');

  // Absolute path
  if (raw.startsWith('/')) return raw;

  // Relative path -> resolve against agent dir
  return join(getAgentDir(), raw);
};

export const ensureSymlinkForAgentFile = (agentPath: string): string => {
  // Only handle files under the real agent dir
  const agentDir = getAgentDir();
  if (!agentPath.startsWith(agentDir + '/') && agentPath !== agentDir) {
    return agentPath;
  }

  // Only symlink if repo dir exists and is the expected repo
  if (!existsSync(REPO_AGENT_DIR)) {
    return agentPath;
  }

  const fileName = basename(agentPath);
  const repoPath = join(REPO_AGENT_DIR, fileName);

  if (agentPath === repoPath) return repoPath;

  // Ensure repo dir exists
  try {
    mkdirSync(dirname(repoPath), { recursive: true });
  } catch {
    // ignore
  }

  // If agentPath already symlink correctly, use repoPath as DB location
  try {
    const stat = lstatSync(agentPath);
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(agentPath);
      // Resolve relative symlink target
      const resolved = target.startsWith('/') ? target : join(dirname(agentPath), target);
      if (resolved === repoPath) {
        return repoPath;
      }
      // Wrong target -> recreate
      unlinkSync(agentPath);
      symlinkSync(repoPath, agentPath);
      return repoPath;
    }
    // Regular file at agentPath -> move to repo if repo not exists
    if (existsSync(agentPath)) {
      if (!existsSync(repoPath)) {
        try {
          renameSync(agentPath, repoPath);
        } catch {
          // fallback: keep both
        }
      } else {
        // Both exist -> remove agentPath file to replace with symlink
        try {
          unlinkSync(agentPath);
        } catch {
          // ignore
        }
      }
      symlinkSync(repoPath, agentPath);
      return repoPath;
    }
  } catch (err) {
    // agentPath does not exist
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Unexpected, fallback
      return agentPath;
    }
    // Create symlink to repoPath (repo file may not exist yet; SQLite will create it)
    try {
      symlinkSync(repoPath, agentPath);
    } catch {
      // ignore - maybe race
    }
    return repoPath;
  }

  // No existing file -> create symlink
  try {
    if (!existsSync(agentPath)) {
      symlinkSync(repoPath, agentPath);
    }
  } catch {
    // ignore
  }
  return repoPath;
};

export class VectorStore {
  private db: InstanceType<typeof import('better-sqlite3')> | undefined;
  private dbPath: string;
  private dimensions: number;
  private initialized = false;
  private initError: string | undefined;

  constructor(dbPath: string, dimensions: number) {
    const resolved = resolveVectorFilePath(dbPath);
    const actual = ensureSymlinkForAgentFile(resolved);
    this.dbPath = actual;
    this.dimensions = dimensions;
  }

  get path(): string {
    return this.dbPath;
  }

  get error(): string | undefined {
    return this.initError;
  }

  isReady(): boolean {
    return this.initialized && !!this.db && !this.initError;
  }

  init(): boolean {
    if (this.initialized) return !this.initError;
    if (!tryLoadNativeDeps() || !DatabaseCtor || !sqliteVecLoad) {
      this.initError = 'Native dependencies better-sqlite3/sqlite-vec not available. Run npm install in the extension directory.';
      return false;
    }

    try {
      // Ensure directory exists
      mkdirSync(dirname(this.dbPath), { recursive: true });

      const db = new DatabaseCtor(this.dbPath);
      // Performance pragmas
      db.pragma('journal_mode = WAL');
      db.pragma('busy_timeout = 5000');
      db.pragma('synchronous = NORMAL');

      // Load sqlite-vec extension
      sqliteVecLoad(db);

      // Verify vec_version available
      try {
        db.prepare('SELECT vec_version()').get();
      } catch (err) {
        this.initError = `sqlite-vec extension failed to load: ${err instanceof Error ? err.message : String(err)}`;
        try { db.close(); } catch { /* ignore */ }
        return false;
      }

      // Create metadata table
      db.exec(`
        CREATE TABLE IF NOT EXISTS router_vectors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          prompt TEXT NOT NULL,
          normalized TEXT NOT NULL UNIQUE,
          tier TEXT NOT NULL,
          reasoning TEXT,
          profile TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          hit_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_router_vectors_normalized ON router_vectors(normalized);
      `);

      // Create vec virtual table
      // Check if exists, if not create with current dimensions
      const vecExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vec_router_vectors'")
        .get() as { name?: string } | undefined;

      if (!vecExists) {
        db.exec(`CREATE VIRTUAL TABLE vec_router_vectors USING vec0(embedding float[${this.dimensions}] distance_metric=cosine)`);
      } else {
        // Validate dimensions match existing table schema by inspecting sql
        const row = db
          .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='vec_router_vectors'")
          .get() as { sql?: string } | undefined;
        const existingDimMatch = row?.sql?.match(/float\[(\d+)\]/);
        const existingDim = existingDimMatch ? parseInt(existingDimMatch[1], 10) : undefined;
        if (existingDim && existingDim !== this.dimensions) {
          // Dimension mismatch - need to recreate. For safety, warn and keep using existing dim.
          // We will set dimensions to existing to avoid errors; new inserts will be validated.
          this.dimensions = existingDim;
        }
      }

      this.db = db;
      this.initialized = true;
      return true;
    } catch (err) {
      this.initError = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // ignore
      }
      this.db = undefined;
      this.initialized = false;
    }
  }

  upsert(
    prompt: string,
    normalized: string,
    tier: RouterTier,
    reasoning: string,
    embedding: number[] | Float32Array,
  ): boolean {
    if (!this.isReady() || !this.db) return false;
    if (!normalized) return false;

    const now = Date.now();
    const vec = embedding instanceof Float32Array ? embedding : new Float32Array(embedding);

    if (vec.length !== this.dimensions) {
      // Dimension mismatch - reject
      return false;
    }

    try {
      const existing = this.db
        .prepare('SELECT id FROM router_vectors WHERE normalized = ?')
        .get(normalized) as { id: number } | undefined;

      const txn = this.db.transaction(() => {
        if (existing) {
          this.db!.prepare(
            'UPDATE router_vectors SET prompt = ?, tier = ?, reasoning = ?, updated_at = ? WHERE id = ?',
          ).run(prompt, tier, reasoning, now, existing.id);

          // Replace vector: delete old, insert new
          this.db!.prepare('DELETE FROM vec_router_vectors WHERE rowid = ?').run(existing.id);
          this.db!.prepare('INSERT INTO vec_router_vectors(rowid, embedding) VALUES (?, ?)').run(
            BigInt(existing.id),
            vec,
          );
        } else {
          const info = this.db!.prepare(
            'INSERT INTO router_vectors(prompt, normalized, tier, reasoning, created_at, updated_at, hit_count) VALUES (?, ?, ?, ?, ?, ?, 0)',
          ).run(prompt, normalized, tier, reasoning, now, now);
          const rowId = Number(info.lastInsertRowid);
          this.db!.prepare('INSERT INTO vec_router_vectors(rowid, embedding) VALUES (?, ?)').run(
            BigInt(rowId),
            vec,
          );
        }
      });

      txn();
      return true;
    } catch {
      return false;
    }
  }

  incrementHit(rowIdOrNormalized: number | string): void {
    if (!this.isReady() || !this.db) return;
    try {
      if (typeof rowIdOrNormalized === 'number') {
        this.db.prepare('UPDATE router_vectors SET hit_count = hit_count + 1 WHERE id = ?').run(rowIdOrNormalized);
      } else {
        this.db.prepare('UPDATE router_vectors SET hit_count = hit_count + 1 WHERE normalized = ?').run(rowIdOrNormalized);
      }
    } catch {
      // ignore
    }
  }

  search(embedding: number[] | Float32Array, k = 1, threshold = 0.88): VectorSearchResult | undefined {
    if (!this.isReady() || !this.db) return undefined;
    const vec = embedding instanceof Float32Array ? embedding : new Float32Array(embedding);
    if (vec.length !== this.dimensions) return undefined;

    try {
      // Quick check emptiness
      const countRow = this.db.prepare('SELECT COUNT(*) as c FROM router_vectors').get() as { c: number } | undefined;
      if (!countRow || countRow.c === 0) return undefined;

      const rows = this.db
        .prepare(
          `SELECT rowid, distance FROM vec_router_vectors WHERE embedding MATCH ? AND k = ?`,
        )
        .all(vec, k) as { rowid: number | bigint; distance: number }[] | undefined;

      if (!rows || rows.length === 0) return undefined;

      const row = rows[0];
      const distance = row.distance;
      // cosine distance = 1 - cosine_similarity  => similarity = 1 - distance
      // For sqlite-vec cosine, distance range 0..2, similarity -1..1. But threshold expects 0..1.
      const similarity = 1 - distance;

      if (similarity < threshold) return undefined;

      const meta = this.db
        .prepare('SELECT prompt, normalized, tier, reasoning, hit_count, updated_at FROM router_vectors WHERE id = ?')
        .get(Number(row.rowid)) as
        | {
            prompt: string;
            normalized: string;
            tier: RouterTier;
            reasoning: string | null;
            hit_count: number;
            updated_at: number;
          }
        | undefined;

      if (!meta) return undefined;

      return {
        prompt: meta.prompt,
        normalized: meta.normalized,
        tier: meta.tier,
        reasoning: meta.reasoning ?? '',
        distance,
        similarity,
        hitCount: meta.hit_count,
        updatedAt: meta.updated_at,
      };
    } catch {
      return undefined;
    }
  }

  getByNormalized(normalized: string): { prompt: string; tier: RouterTier } | undefined {
    if (!this.isReady() || !this.db) return undefined;
    try {
      const row = this.db
        .prepare('SELECT prompt, tier FROM router_vectors WHERE normalized = ?')
        .get(normalized) as { prompt: string; tier: RouterTier } | undefined;
      return row;
    } catch {
      return undefined;
    }
  }

  stats(): { count: number; path: string; dimensions: number } | undefined {
    if (!this.isReady() || !this.db) return undefined;
    try {
      const row = this.db.prepare('SELECT COUNT(*) as c FROM router_vectors').get() as { c: number } | undefined;
      return { count: row?.c ?? 0, path: this.dbPath, dimensions: this.dimensions };
    } catch {
      return undefined;
    }
  }

  clear(): boolean {
    if (!this.isReady() || !this.db) return false;
    try {
      const txn = this.db.transaction(() => {
        this.db!.exec('DELETE FROM router_vectors');
        this.db!.exec('DELETE FROM vec_router_vectors');
        // sqlite-vec may need vacuum?
      });
      txn();
      return true;
    } catch {
      return false;
    }
  }
}

let singletonStore: VectorStore | undefined;
let singletonKey: string | undefined;

export const getVectorStore = (vectorFile: string, dimensions: number): VectorStore | undefined => {
  const resolved = resolveVectorFilePath(vectorFile);
  const actual = ensureSymlinkForAgentFile(resolved);
  const key = `${actual}:${dimensions}`;
  if (singletonStore && singletonKey === key && singletonStore.isReady()) {
    return singletonStore;
  }
  if (singletonStore) {
    singletonStore.close();
    singletonStore = undefined;
    singletonKey = undefined;
  }
  const store = new VectorStore(vectorFile, dimensions);
  const ok = store.init();
  if (!ok) {
    // Keep error for reporting; still return store so caller can read error
    singletonStore = store;
    singletonKey = key;
    return store;
  }
  singletonStore = store;
  singletonKey = key;
  return store;
};

export const closeVectorStore = (): void => {
  if (singletonStore) {
    singletonStore.close();
    singletonStore = undefined;
    singletonKey = undefined;
  }
};

export const getExistingVectorStore = (): VectorStore | undefined => singletonStore;
