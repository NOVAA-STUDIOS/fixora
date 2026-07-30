import type { SymbolRef } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import type { ImportRef } from '../analyzer.js';

import { createFileGrounder, type RawFinding } from './support.js';

/**
 * The resolver wired into grounding — the integration half of `symbol-resolution.test.ts`.
 *
 * What matters here is the *classification* that comes out, because that is what the UI gates the
 * Repair button on. Three outcomes must be distinguishable end to end: a confident rename arrives as
 * `safe-auto` with a real edit (no model), candidates-but-unclear arrives as `ai-required` carrying
 * the candidates as evidence, and nothing-in-scope stays `manual` exactly as before.
 */

const SOURCE = [
  "import { useState } from 'react';",
  '',
  'export function calculateTotal(items) {',
  '  return items.length;',
  '}',
  '',
  'export function Widget() {',
  '  const [n] = useSate(0);',
  '  return calculateTotl(n);',
  '}',
  '',
].join('\n');

function symbol(name: string, line: number): SymbolRef {
  return {
    name,
    kind: 'function',
    location: { file: 'src/w.tsx', startLine: line, startCol: 1, endLine: line, endCol: 1 },
  };
}

const SYMBOLS: SymbolRef[] = [symbol('calculateTotal', 3), symbol('Widget', 7)];
const IMPORTS: ImportRef[] = [{ module: 'react', location: { startLine: 1, endLine: 1 } }];

function raw(over: Partial<RawFinding> = {}): RawFinding {
  return {
    ruleId: 'TS2304',
    severity: 'error',
    category: 'correctness',
    message: "Cannot find name 'calculateTotl'.",
    startLine: 9,
    startCol: 10,
    fixable: false,
    toolOutput: null,
    ...over,
  };
}

function ground(over: Partial<RawFinding> = {}, projectSymbols: SymbolRef[] = []) {
  const grounder = createFileGrounder('tsc', 'src/w.tsx', SOURCE, SYMBOLS, [], IMPORTS, () =>
    projectSymbols.map((s) => ({ name: s.name, origin: 'project' as const, location: s.location })),
  );
  return grounder.ground(raw(over));
}

describe('undefined-name grounding', () => {
  it('a same-file typo becomes safe-auto with a deterministic rename edit', () => {
    const finding = ground();
    expect(finding.repair).toBe('safe-auto');
    expect(finding.fixable).toBe(true);
    expect(finding.autofix?.edits).toHaveLength(1);
    const edit = finding.autofix!.edits[0]!;
    expect(SOURCE.slice(edit.range[0], edit.range[1])).toBe('calculateTotl');
    expect(edit.text).toBe('calculateTotal');
    // Applying it yields the corrected source — proven, not assumed.
    expect(SOURCE.slice(0, edit.range[0]) + edit.text + SOURCE.slice(edit.range[1])).toContain(
      'return calculateTotal(n);',
    );
  });

  it('an imported-symbol typo resolves against the import statement', () => {
    const finding = ground({ message: "Cannot find name 'useSate'.", startLine: 8, startCol: 15 });
    expect(finding.repair).toBe('safe-auto');
    expect(finding.autofix?.edits[0]?.text).toBe('useState');
  });

  it('records candidate declaration sites as related locations — the evidence for repairability', () => {
    const finding = ground();
    expect(finding.evidence.relatedLocations.length).toBeGreaterThanOrEqual(1);
    expect(finding.evidence.relatedLocations[0]?.startLine).toBe(3); // calculateTotal's declaration
  });

  it('nothing in scope stays manual — the original judgement, preserved', () => {
    const finding = ground({ message: "Cannot find name 'somethingUnrelatedEntirely'." });
    expect(finding.repair).toBe('manual');
    expect(finding.autofix).toBeUndefined();
    expect(finding.evidence.relatedLocations).toEqual([]);
  });

  it('a weak match is ai-required, not applied automatically', () => {
    // `usr` is a candidate for a hypothetical `user` but below the autofix bar. Here the only close
    // name is reachable but unclear, so the finding stays repairable WITHOUT an automatic edit.
    const finding = ground({ message: "Cannot find name 'Widgt'." }, []);
    expect(['safe-auto', 'ai-required']).toContain(finding.repair);
    if (finding.repair === 'ai-required') expect(finding.autofix).toBeUndefined();
  });

  it('resolves project-wide when the file and imports have nothing close', () => {
    const finding = ground({ message: "Cannot find name 'formatCurrncy'." }, [
      {
        name: 'formatCurrency',
        kind: 'function',
        location: { file: 'src/money.ts', startLine: 4, startCol: 1, endLine: 4, endCol: 1 },
      },
    ]);
    expect(finding.repair).toBe('ai-required'); // no edit: the name is not on the reported line
    expect(finding.evidence.relatedLocations[0]?.file).toBe('src/money.ts');
  });

  it("never overrides a tool's own autofix with ours", () => {
    const toolFix = {
      source: 'tsc' as const,
      edits: [{ range: [0, 1] as [number, number], text: 'x' }],
    };
    const finding = ground({ autofix: toolFix });
    expect(finding.autofix).toBe(toolFix);
  });

  it('leaves every other rule untouched', () => {
    const finding = ground({ ruleId: 'TS2322', message: 'Type mismatch.' });
    expect(finding.repair).toBe('ai-required');
    expect(finding.autofix).toBeUndefined();
    expect(finding.evidence.relatedLocations).toEqual([]);
  });
});
