import type { Finding } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import type { Analyzer, AnalysisContext, WorkspaceCapabilities } from './analyzer.js';
import { analyzeWorkspace } from './engine.js';
import { createFindingCache, hashSource } from './finding-cache.js';

/**
 * Concurrency, and the finding cache.
 *
 * These are the two things behind a 36s analysis on a 269-file workspace: analyzers waited for each
 * other, and every run started from nothing. What is pinned here is what could go wrong SILENTLY —
 * one failing analyzer taking the others down with it, or a cached finding outliving the content it
 * describes.
 */

function context(overrides: Partial<AnalysisContext> = {}): AnalysisContext {
  const capabilities: WorkspaceCapabilities = { root: '/ws', tools: new Set(), versions: new Map() };
  return {
    root: '/ws',
    capabilities,
    files: [],
    readSource: () => null,
    symbolsFor: () => Promise.resolve([]),
    ...overrides,
  };
}

const finding = (id: string, file = 'src/a.ts'): Finding => ({
  id,
  source: 'complexity',
  ruleId: 'r',
  severity: 'warning',
  category: 'maintainability',
  location: { file, startLine: 1, startCol: 1, endLine: 1, endCol: 2 },
  message: 'm',
  evidence: { snippet: 's', relatedLocations: [], toolOutput: null },
  fixable: false,
  repair: 'manual',
  confidence: 1,
});

async function collect(iter: AsyncIterable<Finding>): Promise<Finding[]> {
  const out: Finding[] = [];
  for await (const f of iter) out.push(f);
  return out;
}
const live = (): AbortSignal => new AbortController().signal;

function slowAnalyzer(id: string, ms: number, findings: Finding[]): Analyzer {
  return {
    id,
    supports: () => true,
    async *run(): AsyncIterable<Finding> {
      await new Promise((resolve) => setTimeout(resolve, ms));
      yield* findings;
    },
  };
}

describe('analyzers run concurrently', () => {
  it('costs the SLOWEST analyzer, not the sum of them', async () => {
    const analyzers = [
      slowAnalyzer('a', 120, [finding('a')]),
      slowAnalyzer('b', 120, [finding('b')]),
      slowAnalyzer('c', 120, [finding('c')]),
    ];
    const started = Date.now();
    const out = await collect(analyzeWorkspace({ context: context(), analyzers }, live()));
    const elapsed = Date.now() - started;

    expect(out).toHaveLength(3);
    // Sequential would be ~360ms. The bound is loose because timers are coarse under load; the claim
    // being tested is "max, not sum", not a precise duration.
    expect(elapsed).toBeLessThan(300);
  });

  it('a fast analyzer does not wait behind a slow one', async () => {
    const analyzers = [
      slowAnalyzer('slow', 150, [finding('slow')]),
      slowAnalyzer('fast', 1, [finding('fast')]),
    ];
    const order: string[] = [];
    for await (const f of analyzeWorkspace({ context: context(), analyzers }, live())) {
      order.push(f.id);
    }
    // Registration order puts `slow` first; arrival order must not.
    expect(order).toEqual(['fast', 'slow']);
  });

  it('one analyzer THROWING does not lose the others’ findings', async () => {
    const exploding: Analyzer = {
      id: 'boom',
      supports: () => true,
      // eslint-disable-next-line @typescript-eslint/require-await, require-yield
      async *run(): AsyncIterable<Finding> {
        throw new Error('analyzer crashed');
      },
    };
    const healthy: Analyzer = {
      id: 'ok',
      supports: () => true,
      // eslint-disable-next-line @typescript-eslint/require-await
      async *run(): AsyncIterable<Finding> {
        yield finding('kept');
      },
    };
    const out = await collect(
      analyzeWorkspace({ context: context(), analyzers: [exploding, healthy] }, live()),
    );
    // The whole point of allSettled semantics: the surviving analyzers' results still reach the user.
    expect(out.map((f) => f.id)).toEqual(['kept']);
  });

  it('stops promptly when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const out = await collect(
      analyzeWorkspace(
        { context: context(), analyzers: [slowAnalyzer('a', 50, [finding('a')])] },
        controller.signal,
      ),
    );
    expect(out).toEqual([]);
  });
});

describe('finding cache', () => {
  const FILE = { file: 'src/a.ts', absPath: '/ws/src/a.ts', language: 'typescript' as const };
  const withSource = (source: string): AnalysisContext =>
    context({ files: [FILE], readSource: () => source });

  /** A file-local analyzer that records how often it was actually asked to run, and over what. */
  function counting(id = 'complexity'): {
    analyzer: Analyzer;
    runs: () => number;
    seen: string[][];
  } {
    let runs = 0;
    const seen: string[][] = [];
    return {
      runs: () => runs,
      seen,
      analyzer: {
        id,
        fileLocal: true,
        supports: () => true,
        // eslint-disable-next-line @typescript-eslint/require-await
        async *run(ctx): AsyncIterable<Finding> {
          runs += 1;
          seen.push(ctx.files.map((f) => f.file));
          for (const file of ctx.files) yield finding('f', file.file);
        },
      },
    };
  }

  it('MISS then HIT — unchanged content is served without re-running the analyzer', async () => {
    const cache = createFindingCache();
    const { analyzer, runs, seen } = counting();

    const first = await collect(
      analyzeWorkspace({ context: withSource('const a = 1;'), analyzers: [analyzer], cache }, live()),
    );
    expect(first).toHaveLength(1);
    expect(runs()).toBe(1);
    expect(cache.size).toBe(1);

    const second = await collect(
      analyzeWorkspace({ context: withSource('const a = 1;'), analyzers: [analyzer], cache }, live()),
    );
    expect(second).toEqual(first);
    expect(runs()).toBe(1);
    expect(seen).toHaveLength(1);
  });

  it('CHANGED content is a miss, and only the changed file is re-analyzed', async () => {
    const cache = createFindingCache();
    const { analyzer, runs, seen } = counting();

    await collect(analyzeWorkspace({ context: withSource('v1'), analyzers: [analyzer], cache }, live()));
    await collect(analyzeWorkspace({ context: withSource('v2'), analyzers: [analyzer], cache }, live()));

    expect(runs()).toBe(2);
    expect(seen[1]).toEqual(['src/a.ts']);
  });

  it('clear() forces full re-analysis — what Re-run and a workspace change do', async () => {
    const cache = createFindingCache();
    const { analyzer, runs } = counting();

    await collect(analyzeWorkspace({ context: withSource('same'), analyzers: [analyzer], cache }, live()));
    cache.clear();
    expect(cache.size).toBe(0);
    await collect(analyzeWorkspace({ context: withSource('same'), analyzers: [analyzer], cache }, live()));
    expect(runs()).toBe(2);
  });

  it('NEVER caches an analyzer that has not declared itself file-local', async () => {
    // The safety property. eslint and tsc read OTHER files, so a cached "clean" verdict could outlive
    // the change elsewhere that broke this file — a lie, and a quiet one.
    const cache = createFindingCache();
    let runs = 0;
    const crossFile: Analyzer = {
      id: 'tsc',
      supports: () => true,
      // eslint-disable-next-line @typescript-eslint/require-await
      async *run(): AsyncIterable<Finding> {
        runs += 1;
        yield finding('t');
      },
    };
    for (let i = 0; i < 3; i += 1) {
      await collect(
        analyzeWorkspace({ context: withSource('unchanged'), analyzers: [crossFile], cache }, live()),
      );
    }
    expect(runs).toBe(3);
    expect(cache.size).toBe(0);
  });

  it('does not cache a run that was aborted midway', async () => {
    // A partial run recorded as complete would mark files "analyzed, no findings" and suppress their
    // real findings on every later pass.
    const cache = createFindingCache();
    const controller = new AbortController();
    const analyzer: Analyzer = {
      id: 'complexity',
      fileLocal: true,
      supports: () => true,
      // eslint-disable-next-line @typescript-eslint/require-await
      async *run(): AsyncIterable<Finding> {
        controller.abort();
        yield finding('never');
      },
    };
    await collect(
      analyzeWorkspace({ context: withSource('x'), analyzers: [analyzer], cache }, controller.signal),
    );
    expect(cache.size).toBe(0);
  });

  it('an entry for one analyzer never answers for another', async () => {
    const cache = createFindingCache();
    cache.set('complexity', 'src/a.ts', hashSource('x'), [finding('c')]);
    expect(cache.get('json', 'src/a.ts', hashSource('x'))).toBeNull();
    expect(cache.get('complexity', 'src/a.ts', hashSource('x'))).toHaveLength(1);
    await Promise.resolve();
  });

  it('an unreadable file is always treated as changed, never as cached', async () => {
    const cache = createFindingCache();
    const { analyzer, runs } = counting();
    const ctx = context({ files: [FILE], readSource: () => null });
    await collect(analyzeWorkspace({ context: ctx, analyzers: [analyzer], cache }, live()));
    await collect(analyzeWorkspace({ context: ctx, analyzers: [analyzer], cache }, live()));
    expect(runs()).toBe(2);
    expect(cache.size).toBe(0);
  });
});
