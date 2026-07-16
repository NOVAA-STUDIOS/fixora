import type { Finding } from '@fixora/shared-types';

import type { Analyzer, AnalysisTarget, WorkspaceCapabilities } from './analyzer.js';
import { cacheKey, type FindingsCache } from './cache.js';
import { applicableAnalyzers, defaultAnalyzers } from './registry.js';

/**
 * The engine: run every applicable analyzer over one file and stream the findings as they arrive, so
 * the panel fills incrementally rather than blocking on the slowest tool. Cancellation is honoured
 * (the whole run stops on abort); results are cached per analyzer by content + version + config so an
 * unchanged file is not re-analyzed. This is the seam the utility-process host (M3 §4) drives.
 */

/** Some analyzers' id differs from their tool's (go-vet runs `go`); map for the cache version key. */
const TOOL_ID: Record<string, string> = { 'go-vet': 'go' };

export interface AnalyzeFileOptions {
  target: AnalysisTarget;
  capabilities: WorkspaceCapabilities;
  /** Defaults to the full roster; injectable for tests and for a reduced run. */
  analyzers?: readonly Analyzer[];
  /** Optional incremental cache; omit for a always-fresh run. */
  cache?: FindingsCache;
  /** A fingerprint of the relevant tool configs, folded into the cache key. */
  configHash?: string;
}

export async function* analyzeFile(
  options: AnalyzeFileOptions,
  signal: AbortSignal,
): AsyncIterable<Finding> {
  const analyzers = options.analyzers ?? defaultAnalyzers();
  const applicable = applicableAnalyzers(analyzers, options.target.language, options.capabilities);
  // Read the signal through a call so control-flow narrowing does not make a later `!aborted()`
  // look constant to the type-checker — the flag really can flip during a `for await`.
  const aborted = (): boolean => signal.aborted;

  for (const analyzer of applicable) {
    if (aborted()) return;

    const version = options.capabilities.versions.get(TOOL_ID[analyzer.id] ?? analyzer.id);
    const key =
      options.cache === undefined
        ? undefined
        : cacheKey(analyzer.id, options.target, version, options.configHash);

    if (options.cache !== undefined && key !== undefined) {
      const cached = options.cache.get(key);
      if (cached !== undefined) {
        yield* cached;
        continue;
      }
    }

    const collected: Finding[] = [];
    for await (const finding of analyzer.analyze(options.target, signal)) {
      collected.push(finding);
      yield finding;
    }

    // Only cache a complete run — a half-finished, aborted run must not masquerade as the answer.
    if (options.cache !== undefined && key !== undefined && !aborted()) {
      options.cache.set(key, collected);
    }
  }
}
