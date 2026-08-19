import type { Finding } from '@fixora/shared-types';

import type { AnalysisContext, Analyzer } from './analyzer.js';
import { type FindingCache, splitByCache } from './finding-cache.js';
import { applicableAnalyzers, defaultAnalyzers } from './registry.js';

/**
 * The engine: run every applicable analyzer over the workspace and stream findings as they arrive, so
 * the panel fills incrementally rather than blocking on the slowest tool. Each analyzer runs **once**
 * (its `run()` iterates the files itself), which is what makes analysis scale — an external tool is
 * spawned a single time, not per file. Cancellation stops the whole run promptly.
 *
 * Analyzers run CONCURRENTLY. They were sequential, so the wall clock was their sum even though they
 * share nothing but a read-only context: measured on a 269-file workspace, 36.2s total of which eslint
 * was 30.4s and complexity 8.5s. Run concurrently the cost is the slowest one rather than the sum.
 *
 * One analyzer failing must not take the others with it — the same reason `Promise.allSettled` exists.
 * A run that produced six analyzers' findings and lost the seventh is far more useful than one that
 * reports nothing, and every analyzer already treats its own failure as "no findings, never throw".
 */

export interface AnalyzeWorkspaceOptions {
  context: AnalysisContext;
  /** Defaults to the full roster; injectable for tests and for a reduced run. */
  analyzers?: readonly Analyzer[];
  /**
   * Reuse findings for files whose content is unchanged since the last run.
   *
   * Consulted ONLY for analyzers that declare `fileLocal` — see `finding-cache.ts` for why offering
   * it to the others would serve stale results.
   */
  cache?: FindingCache;
}

/**
 * Drain several async iterables into one, yielding whatever is ready first.
 *
 * Written by hand rather than pulled from a library because the failure semantics are the point: a
 * source that throws is dropped and the merge continues, so one broken analyzer cannot end the run.
 */
/** Each analyzer typically spawns its own child process (ESLint, mypy, go vet, …) — starting every
 * applicable one at once is fine on a fast machine, but on a low-end CPU (the target hardware this
 * cap exists for) that many concurrent child processes thrash rather than finish sooner. Capped at
 * 2: enough to overlap I/O-bound waits between analyzers without saturating a 2-4 logical core
 * machine. */
const MAX_CONCURRENT_ANALYZERS = 2;

async function* merge<T>(sources: readonly AsyncIterable<T>[]): AsyncIterable<T> {
  const iterators = sources.map((source) => source[Symbol.asyncIterator]());
  // Keyed by iterator index, so a settled promise can be replaced with that iterator's next pull.
  const pending = new Map<number, Promise<{ index: number; result: IteratorResult<T> }>>();
  // Analyzers not yet started — pulled from as running ones finish, never all at once.
  const queued = iterators.map((_, index) => index).slice(MAX_CONCURRENT_ANALYZERS);

  const pull = (index: number): void => {
    const iterator = iterators[index];
    if (iterator === undefined) return;
    pending.set(
      index,
      iterator.next().then(
        (result) => ({ index, result }),
        // A throwing analyzer is treated as one that simply ended. Rejecting the merged stream would
        // discard the findings every other analyzer had already produced.
        () => ({ index, result: { done: true, value: undefined } as IteratorResult<T> }),
      ),
    );
  };

  iterators.slice(0, MAX_CONCURRENT_ANALYZERS).forEach((_, index) => {
    pull(index);
  });

  while (pending.size > 0) {
    const { index, result } = await Promise.race(pending.values());
    if (result.done === true) {
      pending.delete(index);
      const next = queued.shift();
      if (next !== undefined) pull(next);
    } else {
      pull(index);
      yield result.value;
    }
  }
}

export async function* analyzeWorkspace(
  options: AnalyzeWorkspaceOptions,
  signal: AbortSignal,
): AsyncIterable<Finding> {
  const analyzers = options.analyzers ?? defaultAnalyzers();
  const active = applicableAnalyzers(analyzers, options.context.capabilities);
  if (signal.aborted) return;

  const streams = active.map((analyzer) => runAnalyzer(analyzer, options, signal));

  // Read through a call: `aborted` is mutated outside this function's control flow, which TypeScript
  // narrows away after the guard above. Same helper shape used across the codebase.
  const aborted = (): boolean => signal.aborted;
  for await (const finding of merge(streams)) {
    if (aborted()) return;
    yield finding;
  }
}

/**
 * One analyzer's findings, served from cache wherever the file has not changed.
 *
 * For a cacheable analyzer this narrows the context to the files that actually changed, so the
 * analyzer does its own iteration over a shorter list and no analyzer needs to know a cache exists.
 */
async function* runAnalyzer(
  analyzer: Analyzer,
  options: AnalyzeWorkspaceOptions,
  signal: AbortSignal,
): AsyncIterable<Finding> {
  const { context, cache } = options;
  if (cache === undefined || analyzer.fileLocal !== true) {
    yield* analyzer.run(context, signal);
    return;
  }

  const split = splitByCache(cache, analyzer.id, context);
  // Everything already known, yielded before the run starts — so an unchanged workspace paints
  // immediately rather than after the slowest analyzer that did have work to do.
  for (const finding of split.cached) {
    if (signal.aborted) return;
    yield finding;
  }
  if (split.stale.length === 0) return;

  const produced = new Map<string, Finding[]>();
  for (const file of split.stale) produced.set(file.file, []);

  for await (const finding of analyzer.run({ ...context, files: split.stale }, signal)) {
    if (signal.aborted) return;
    // A finding whose file is not in the stale set cannot be attributed to one, so it passes through
    // uncached rather than being filed against the wrong key.
    produced.get(finding.location.file)?.push(finding);
    yield finding;
  }

  // Written only after the run completes. A cancelled or partial run must not leave a file recorded
  // as "analyzed, no findings" — that would suppress its real findings on every later pass.
  if (signal.aborted) return;
  for (const [file, findings] of produced) {
    const hash = split.hashes.get(file);
    if (hash !== undefined) cache.set(analyzer.id, file, hash, findings);
  }
}
