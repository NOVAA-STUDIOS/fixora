import { createHash } from 'node:crypto';

import type { Finding } from '@fixora/shared-types';

import type { AnalysisTarget } from './analyzer.js';

/**
 * Incremental analysis is cache-keyed by **content + tool version + config** (TDD §5.2): re-running a
 * tool on a file that has not changed, with a tool that has not changed, under a config that has not
 * changed, must produce the same findings — so we return them from cache instead of paying for the
 * subprocess again. On a file change we re-analyze that file, not the workspace.
 *
 * The cache is an interface so the engine can run against an in-memory map (tests, a CLI) or the
 * SQLite-backed store the desktop uses (M3 §4) without either side knowing which.
 */
export interface FindingsCache {
  get(key: string): Finding[] | undefined;
  set(key: string, findings: Finding[]): void;
}

/** The cache key for one analyzer's result on one file — content + tool version + config fingerprint. */
export function cacheKey(
  analyzerId: string,
  target: AnalysisTarget,
  toolVersion: string | undefined,
  configHash: string | undefined,
): string {
  const contentHash = createHash('sha256').update(target.source).digest('hex');
  return JSON.stringify([
    analyzerId,
    target.file,
    contentHash,
    toolVersion ?? '',
    configHash ?? '',
  ]);
}

/** A trivial in-memory cache (a `Map`) — for tests, a CLI, or a single analysis session. */
export function createMemoryCache(): FindingsCache {
  const store = new Map<string, Finding[]>();
  return {
    get: (key) => store.get(key),
    set: (key, findings) => {
      store.set(key, findings);
    },
  };
}
