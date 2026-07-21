import type { Finding } from '@fixora/shared-types';
import { describe, expect, it, vi } from 'vitest';

import type { Analyzer, AnalysisContext, WorkspaceCapabilities } from './analyzer.js';
import { analyzeWorkspace } from './engine.js';

/**
 * The engine wires analyzers + cancellation together. Fake analyzers assert the orchestration —
 * applicability filtering, streaming across analyzers, and prompt abort — independent of any tool.
 */

function context(tools: string[] = []): AnalysisContext {
  const capabilities: WorkspaceCapabilities = {
    root: '/ws',
    tools: new Set(tools),
    versions: new Map(),
  };
  return {
    root: '/ws',
    capabilities,
    files: [],
    readSource: () => null,
    symbolsFor: () => Promise.resolve([]),
  };
}

function fakeAnalyzer(
  id: string,
  findings: Finding[],
  supports: (ws: WorkspaceCapabilities) => boolean,
): Analyzer {
  return {
    id,
    supports,
    // eslint-disable-next-line @typescript-eslint/require-await
    run: vi.fn(async function* (): AsyncIterable<Finding> {
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
  repair: 'manual',
  confidence: 1,
});

async function collect(iter: AsyncIterable<Finding>): Promise<Finding[]> {
  const out: Finding[] = [];
  for await (const f of iter) out.push(f);
  return out;
}
const live = (): AbortSignal => new AbortController().signal;

describe('analyzeWorkspace orchestration', () => {
  it('runs only the applicable analyzers and streams their findings in order', async () => {
    const first = fakeAnalyzer('first', [finding('a')], () => true);
    const skipped = fakeAnalyzer('skipped', [finding('b')], () => false);
    const second = fakeAnalyzer('second', [finding('c')], () => true);
    const out = await collect(
      analyzeWorkspace({ context: context(), analyzers: [first, skipped, second] }, live()),
    );
    expect(out.map((f) => f.id)).toEqual(['a', 'c']);
    expect(skipped.run).not.toHaveBeenCalled();
  });

  it('passes capabilities to supports() so a tool-gated analyzer only runs when present', async () => {
    const eslint = fakeAnalyzer('eslint', [finding('a')], (ws) => ws.tools.has('eslint'));
    expect(
      await collect(analyzeWorkspace({ context: context([]), analyzers: [eslint] }, live())),
    ).toEqual([]);
    expect(
      (
        await collect(
          analyzeWorkspace({ context: context(['eslint']), analyzers: [eslint] }, live()),
        )
      ).map((f) => f.id),
    ).toEqual(['a']);
  });

  it('does not start any analyzer when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const analyzer = fakeAnalyzer('a', [finding('a')], () => true);
    const out = await collect(
      analyzeWorkspace({ context: context(), analyzers: [analyzer] }, controller.signal),
    );
    expect(out).toEqual([]);
    expect(analyzer.run).not.toHaveBeenCalled();
  });
});
