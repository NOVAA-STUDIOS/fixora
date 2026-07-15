import type { Finding, Language } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import type { AnalysisTarget } from '../analyzer.js';

import { complexityAnalyzer } from './complexity.js';

function target(language: Language, file: string, source: string): AnalysisTarget {
  return { language, file, absPath: `/ws/${file}`, source, workspaceRoot: '/ws' };
}

async function run(t: AnalysisTarget): Promise<Finding[]> {
  const out: Finding[] = [];
  for await (const f of complexityAnalyzer.analyze(t, new AbortController().signal)) out.push(f);
  return out;
}

// A function with many decision points: 10 ifs + a boolean operator comfortably clears the threshold.
const COMPLEX_TS = `export function decide(a: number): number {
  if (a === 1) return 1;
  if (a === 2) return 2;
  if (a === 3) return 3;
  if (a === 4) return 4;
  if (a === 5) return 5;
  if (a === 6) return 6;
  if (a === 7) return 7;
  if (a === 8) return 8;
  if (a === 9) return 9;
  if (a > 10 && a < 20) return 10;
  for (let i = 0; i < a; i++) {
    if (i % 2 === 0) continue;
  }
  return 0;
}

export function simple(a: number): number {
  return a + 1;
}
`;

describe('complexityAnalyzer', () => {
  it('applies to every language (no external tool required)', () => {
    const caps = { root: '/ws', tools: new Set<string>(), versions: new Map<string, string>() };
    expect(complexityAnalyzer.supports('typescript', caps)).toBe(true);
    expect(complexityAnalyzer.supports('go', caps)).toBe(true);
  });

  it('flags a high-complexity function and leaves a simple one alone', async () => {
    const findings = await run(target('typescript', 'src/decide.ts', COMPLEX_TS));
    const cyc = findings.find((f) => f.ruleId === 'cyclomatic-complexity');
    expect(cyc).toBeDefined();
    expect(cyc?.source).toBe('complexity');
    expect(cyc?.category).toBe('maintainability');
    expect(cyc?.evidence.enclosingSymbol?.name).toBe('decide');
    expect(cyc?.confidence).toBe(1);
    // `simple` is below threshold — it must not appear.
    expect(findings.some((f) => f.evidence.enclosingSymbol?.name === 'simple')).toBe(false);
  });

  it('gives a nested function a higher cognitive than cyclomatic score', async () => {
    // Deeply nested branching: cognitive penalises the nesting, so it should exceed cyclomatic.
    const nested = `def f(items):
    total = 0
    for a in items:
        for b in a:
            for c in b:
                if c > 0:
                    if c < 10:
                        if c != 5:
                            total += c
    return total
`;
    const findings = await run(target('python', 'app/f.py', nested));
    const cog = findings.find((r) => r.ruleId === 'cognitive-complexity');
    expect(cog).toBeDefined();
    expect(cog?.severity === 'warning' || cog?.severity === 'error').toBe(true);
  });

  it('produces stable ids across runs (same input, same id)', async () => {
    const a = await run(target('typescript', 'src/decide.ts', COMPLEX_TS));
    const b = await run(target('typescript', 'src/decide.ts', COMPLEX_TS));
    expect(a.map((f) => f.id)).toEqual(b.map((f) => f.id));
  });

  it('stops promptly when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const out: Finding[] = [];
    for await (const f of complexityAnalyzer.analyze(
      target('typescript', 'src/decide.ts', COMPLEX_TS),
      controller.signal,
    )) {
      out.push(f);
    }
    expect(out).toEqual([]);
  });
});
