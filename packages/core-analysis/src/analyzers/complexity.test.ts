import type { Finding, Language } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import type { AnalysisFile } from '../analyzer.js';
import { createAnalysisContext } from '../context.js';

import { complexityAnalyzer } from './complexity.js';

interface FileWithSource extends AnalysisFile {
  source: string;
}

function context(files: FileWithSource[]) {
  const sources = new Map(files.map((f) => [f.absPath, f.source]));
  return createAnalysisContext({
    root: '/ws',
    capabilities: { root: '/ws', tools: new Set<string>(), versions: new Map<string, string>() },
    files: files.map(({ file, absPath, language }) => ({ file, absPath, language })),
    readSource: (p) => sources.get(p) ?? null,
  });
}

async function run(files: FileWithSource[]): Promise<Finding[]> {
  const out: Finding[] = [];
  for await (const f of complexityAnalyzer.run(context(files), new AbortController().signal)) {
    out.push(f);
  }
  return out;
}

function file(file: string, language: Language, source: string): FileWithSource {
  return { file, absPath: `/ws/${file}`, language, source };
}

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
  it('is always active (no external tool required)', () => {
    const caps = { root: '/ws', tools: new Set<string>(), versions: new Map<string, string>() };
    expect(complexityAnalyzer.supports(caps)).toBe(true);
  });

  it('flags a high-complexity function and leaves a simple one alone', async () => {
    const findings = await run([file('src/decide.ts', 'typescript', COMPLEX_TS)]);
    const cyc = findings.find((f) => f.ruleId === 'cyclomatic-complexity');
    expect(cyc).toBeDefined();
    expect(cyc?.source).toBe('complexity');
    expect(cyc?.category).toBe('maintainability');
    expect(cyc?.evidence.enclosingSymbol?.name).toBe('decide');
    expect(cyc?.location.file).toBe('src/decide.ts');
    expect(findings.some((f) => f.evidence.enclosingSymbol?.name === 'simple')).toBe(false);
  });

  it('iterates every file in the workspace', async () => {
    const findings = await run([
      file('a.ts', 'typescript', COMPLEX_TS),
      file('b.ts', 'typescript', COMPLEX_TS),
    ]);
    const files = new Set(findings.map((f) => f.location.file));
    expect(files).toEqual(new Set(['a.ts', 'b.ts']));
  });

  it('gives a nested function a cognitive complexity finding', async () => {
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
    const findings = await run([file('app/f.py', 'python', nested)]);
    const cog = findings.find((r) => r.ruleId === 'cognitive-complexity');
    expect(cog).toBeDefined();
    expect(cog?.severity === 'warning' || cog?.severity === 'error').toBe(true);
  });

  it('produces stable ids across runs', async () => {
    const a = await run([file('src/decide.ts', 'typescript', COMPLEX_TS)]);
    const b = await run([file('src/decide.ts', 'typescript', COMPLEX_TS)]);
    expect(a.map((f) => f.id)).toEqual(b.map((f) => f.id));
  });

  it('stops promptly when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const out: Finding[] = [];
    for await (const f of complexityAnalyzer.run(
      context([file('src/decide.ts', 'typescript', COMPLEX_TS)]),
      controller.signal,
    )) {
      out.push(f);
    }
    expect(out).toEqual([]);
  });
});
