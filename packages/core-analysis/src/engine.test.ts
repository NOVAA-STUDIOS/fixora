import type { Finding, Language } from '@fixora/shared-types';
import { describe, expect, it, vi } from 'vitest';

import type { Analyzer, AnalysisTarget, WorkspaceCapabilities } from './analyzer.js';
import { createMemoryCache } from './cache.js';
import { analyzeFile } from './engine.js';

/**
 * The engine wires analyzers + cache + cancellation together. These tests use fake analyzers so they
 * assert the *orchestration* — applicability filtering, streaming, cache hit/miss, and that an
 * aborted run is not cached — independent of any real tool.
 */

function target(source = 'x'): AnalysisTarget {
  return {
    file: 'src/a.ts',
    absPath: '/ws/src/a.ts',
    language: 'typescript',
    source,
    workspaceRoot: '/ws',
  };
}
function caps(tools: string[] = [], versions: [string, string][] = []): WorkspaceCapabilities {
  return { root: '/ws', tools: new Set(tools), versions: new Map(versions) };
}

function fakeAnalyzer(
  id: string,
  findings: Finding[],
  supports: (lang: Language, ws: WorkspaceCapabilities) => boolean,
): Analyzer {
  return {
    id,
    supports,
    // eslint-disable-next-line @typescript-eslint/require-await
    analyze: vi.fn(async function* (): AsyncIterable<Finding> {
      yield* findings;
    }),
  };
}

const finding = (id: string): Finding => ({
  id,
  source: 'complexity',
  ruleId: 'r',
  severity: 'warning',
  category: 'maintainability',
  location: { file: 'src/a.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 2 },
  message: 'm',
  evidence: { snippet: 's', relatedLocations: [], toolOutput: null },
  fixable: false,
  confidence: 1,
});

async function collect(iter: AsyncIterable<Finding>): Promise<Finding[]> {
  const out: Finding[] = [];
  for await (const f of iter) out.push(f);
  return out;
}
const live = (): AbortSignal => new AbortController().signal;

describe('analyzeFile orchestration', () => {
  it('runs only the applicable analyzers and streams their findings', async () => {
    const yes = fakeAnalyzer('yes', [finding('a')], () => true);
    const no = fakeAnalyzer('no', [finding('b')], () => false);
    const out = await collect(
      analyzeFile({ target: target(), capabilities: caps(), analyzers: [yes, no] }, live()),
    );
    expect(out.map((f) => f.id)).toEqual(['a']);
    expect(no.analyze).not.toHaveBeenCalled();
  });

  it('serves a second identical run from cache without re-running the analyzer', async () => {
    const analyzer = fakeAnalyzer('complexity', [finding('a')], () => true);
    const cache = createMemoryCache();
    const opts = { target: target(), capabilities: caps(), analyzers: [analyzer], cache };
    await collect(analyzeFile(opts, live()));
    await collect(analyzeFile(opts, live()));
    expect(analyzer.analyze).toHaveBeenCalledTimes(1); // second run was a cache hit
  });

  it('re-runs when the file content changes (cache key includes the content hash)', async () => {
    const analyzer = fakeAnalyzer('complexity', [finding('a')], () => true);
    const cache = createMemoryCache();
    await collect(
      analyzeFile(
        { target: target('v1'), capabilities: caps(), analyzers: [analyzer], cache },
        live(),
      ),
    );
    await collect(
      analyzeFile(
        { target: target('v2'), capabilities: caps(), analyzers: [analyzer], cache },
        live(),
      ),
    );
    expect(analyzer.analyze).toHaveBeenCalledTimes(2);
  });

  it('re-runs when the tool version changes (cache key includes the version)', async () => {
    const analyzer = fakeAnalyzer('eslint', [finding('a')], () => true);
    const cache = createMemoryCache();
    await collect(
      analyzeFile(
        {
          target: target(),
          capabilities: caps(['eslint'], [['eslint', '9.0.0']]),
          analyzers: [analyzer],
          cache,
        },
        live(),
      ),
    );
    await collect(
      analyzeFile(
        {
          target: target(),
          capabilities: caps(['eslint'], [['eslint', '9.1.0']]),
          analyzers: [analyzer],
          cache,
        },
        live(),
      ),
    );
    expect(analyzer.analyze).toHaveBeenCalledTimes(2);
  });

  it('does not cache an aborted run', async () => {
    const controller = new AbortController();
    controller.abort();
    const analyzer = fakeAnalyzer('complexity', [finding('a')], () => true);
    const cache = createMemoryCache();
    const out = await collect(
      analyzeFile(
        { target: target(), capabilities: caps(), analyzers: [analyzer], cache },
        controller.signal,
      ),
    );
    expect(out).toEqual([]); // aborted before running
    // A fresh run now must actually execute the analyzer (nothing was cached).
    await collect(
      analyzeFile({ target: target(), capabilities: caps(), analyzers: [analyzer], cache }, live()),
    );
    expect(analyzer.analyze).toHaveBeenCalledTimes(1);
  });
});
