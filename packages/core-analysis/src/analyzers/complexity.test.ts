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

  it('scores a flat else-if chain flat, not quadratically (was a false positive)', async () => {
    // Measured before this fix: 6 trivial, unnested else-if branches (no real nesting anywhere)
    // scored cognitive complexity 21 — over the warning threshold of 16 — because TS/JS represents
    // `else if` as a nested if_statement and the walker treated every nesting level as genuinely
    // deeper. A dispatch-style chain like this is exactly the "not actually complex" case the metric
    // exists to distinguish from real nesting.
    const elseIfChain = `export function classify(n: number): string {
  if (n === 1) {
    return 'a';
  } else if (n === 2) {
    return 'b';
  } else if (n === 3) {
    return 'c';
  } else if (n === 4) {
    return 'd';
  } else if (n === 5) {
    return 'e';
  } else if (n === 6) {
    return 'f';
  }
  return 'z';
}
`;
    const findings = await run([file('src/classify2.ts', 'typescript', elseIfChain)]);
    expect(findings).toEqual([]); // cognitive ~6 (flat), well under the warn threshold of 16
  });

  it('still escalates depth for a GENUINE nested if (not else-if) inside a branch', async () => {
    // Guards against overcorrecting: an if nested inside another if's *consequence* (not its
    // alternative) is real nesting and must still cost more than a flat chain of the same size.
    const genuinelyNested = `export function deep(n: number): string {
  if (n > 0) {
    if (n > 10) {
      if (n > 20) {
        if (n > 30) {
          if (n > 40) {
            if (n > 50) {
              return 'big';
            }
          }
        }
      }
    }
  }
  return 'small';
}
`;
    const findings = await run([file('src/deep.ts', 'typescript', genuinelyNested)]);
    const cog = findings.find((f) => f.ruleId === 'cognitive-complexity');
    // 6 genuinely nested ifs: 1+2+3+4+5+6 = 21 — must still fire, unlike the flat chain above.
    expect(cog).toBeDefined();
    expect(cog?.message).toContain('of 21');
  });

  it('produces stable ids across runs', async () => {
    const a = await run([file('src/decide.ts', 'typescript', COMPLEX_TS)]);
    const b = await run([file('src/decide.ts', 'typescript', COMPLEX_TS)]);
    expect(a.map((f) => f.id)).toEqual(b.map((f) => f.id));
  });

  it('measures a branchy callback passed inline as an argument (was a silent false negative)', async () => {
    // A real, common shape (`array.map((x) => { ...branches... })`) whose branching previously vanished:
    // the callback was never captured as its own unit, and was explicitly skipped while walking
    // `classify`'s body — so a genuinely complex function reported zero findings.
    const withCallback = `export function classify(items: number[]): string[] {
  return items.map((item) => {
    if (item === 1) return 'a';
    if (item === 2) return 'b';
    if (item === 3) return 'c';
    if (item === 4) return 'd';
    if (item === 5) return 'e';
    if (item === 6) return 'f';
    if (item === 7) return 'g';
    if (item === 8) return 'h';
    if (item === 9) return 'i';
    if (item === 10) return 'j';
    if (item === 11) return 'k';
    return 'z';
  });
}
`;
    const findings = await run([file('src/classify.ts', 'typescript', withCallback)]);
    const cyc = findings.find((f) => f.ruleId === 'cyclomatic-complexity');
    expect(cyc).toBeDefined();
    expect(cyc?.message).toContain('of 12');
    // Named after its enclosing binding when it has no name of its own, never silently dropped.
    expect(cyc?.evidence.enclosingSymbol?.name).toBe('anonymous function');
    // `classify` itself contains no branches — only its callback does — so it gets no finding.
    expect(findings.some((f) => f.evidence.enclosingSymbol?.name === 'classify')).toBe(false);
  });

  it('names an anonymous callback from its call-site key when it is an object method shorthand', async () => {
    const objectMethod = `export const handlers = {
  onClick: function (a: number) {
    if (a === 1) return 1;
    if (a === 2) return 2;
    if (a === 3) return 3;
    if (a === 4) return 4;
    if (a === 5) return 5;
    if (a === 6) return 6;
    if (a === 7) return 7;
    if (a === 8) return 8;
    if (a === 9) return 9;
    if (a === 10) return 10;
    if (a === 11) return 11;
    return 0;
  },
};
`;
    const findings = await run([file('src/handlers.ts', 'typescript', objectMethod)]);
    const cyc = findings.find((f) => f.ruleId === 'cyclomatic-complexity');
    expect(cyc?.evidence.enclosingSymbol?.name).toBe('onClick');
  });

  it('still names a directly-declared function normally (no regression from the broadened query)', async () => {
    const findings = await run([file('src/decide.ts', 'typescript', COMPLEX_TS)]);
    const cyc = findings.find((f) => f.ruleId === 'cyclomatic-complexity');
    expect(cyc?.evidence.enclosingSymbol?.name).toBe('decide');
    expect(cyc?.evidence.enclosingSymbol?.kind).toBe('function');
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
