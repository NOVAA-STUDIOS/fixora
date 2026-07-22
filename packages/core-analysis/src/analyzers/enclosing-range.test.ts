import { describe, expect, it } from 'vitest';

import { parse } from '../parser/tree-sitter.js';
import { parseStructure } from '../structure.js';

import type { RawFinding } from './support.js';
import { createFileGrounder } from './support.js';

/**
 * P0 regression — the exact TS2322 failure.
 *
 * A type error inside an object literal (`count: "hello"` in `export const settings: Settings = {…}`)
 * has NO enclosing named symbol, so the repair target used to be the single partial line
 * `count: "hello",`. The model was handed that isolated line — mislabelled "(top-level code)" — and
 * any replacement for it splices back into a broken object, which the parser then rejects.
 *
 * The fix grounds such a finding on the smallest COMPLETE top-level block. These pin that: the finding
 * carries the whole declaration's range, and splicing a valid replacement across that range parses
 * cleanly — where splicing across the old single-line range does not.
 */
const OBJECT_LITERAL = `interface Settings {
  count: number;
}

export const settings: Settings = {
  count: "hello",
};
`;

function splice(content: string, startLine: number, endLine: number, replacement: string): string {
  const lines = content.split('\n');
  return [
    ...lines.slice(0, startLine - 1),
    ...replacement.split('\n'),
    ...lines.slice(endLine),
  ].join('\n');
}

async function parses(source: string): Promise<boolean> {
  const tree = await parse('typescript', source, 'a.ts');
  try {
    return !tree.root.hasError;
  } finally {
    tree.dispose();
  }
}

describe('enclosing-range grounding (TS2322-in-object-literal)', () => {
  it('grounds a finding with no enclosing symbol on the complete top-level declaration', async () => {
    const { symbols, blocks } = await parseStructure('typescript', OBJECT_LITERAL, 'a.ts');
    const grounder = createFileGrounder('tsc', 'a.ts', OBJECT_LITERAL, symbols, blocks);
    // A TS2322 as tsc would report it: on the `count: "hello"` line (line 6).
    const raw: RawFinding = {
      ruleId: 'TS2322',
      severity: 'error',
      category: 'correctness',
      message: "Type 'string' is not assignable to type 'number'.",
      startLine: 6,
      startCol: 3,
      fixable: false,
      toolOutput: null,
    };
    const finding = grounder.ground(raw);

    expect(finding.evidence.enclosingSymbol).toBeUndefined(); // object literals are not symbols
    // The whole `export const settings … = { … };` declaration — a complete, splice-valid unit.
    expect(finding.evidence.enclosingRange).toEqual({ startLine: 5, endLine: 7 });
  });

  it('splicing a valid repair across the enclosing RANGE parses; across the bare line it does NOT', async () => {
    // What a model returns when given the complete declaration: a complete, corrected declaration.
    const goodWholeBlock = `export const settings: Settings = {\n  count: 0,\n};`;
    expect(await parses(splice(OBJECT_LITERAL, 5, 7, goodWholeBlock))).toBe(true);

    // The old path: the model is given only line 6 and, thinking it is top-level code, returns a
    // statement. Spliced across the single line, the object literal is now malformed — exactly the
    // parser rejection this fix removes.
    const isolatedSnippet = 'const count = 0;';
    expect(await parses(splice(OBJECT_LITERAL, 6, 6, isolatedSnippet))).toBe(false);
  });

  it('leaves a finding INSIDE a named symbol grounded on the symbol, not a block', async () => {
    const withFn = `export function greet(name: string): string {\n  const n: number = name;\n  return \`\${n}\`;\n}\n`;
    const { symbols, blocks } = await parseStructure('typescript', withFn, 'b.ts');
    const grounder = createFileGrounder('tsc', 'b.ts', withFn, symbols, blocks);
    const finding = grounder.ground({
      ruleId: 'TS2322',
      severity: 'error',
      category: 'correctness',
      message: "Type 'string' is not assignable to type 'number'.",
      startLine: 2,
      startCol: 9,
      fixable: false,
      toolOutput: null,
    });
    expect(finding.evidence.enclosingSymbol?.name).toBe('greet');
    // enclosingRange is only for the no-symbol case — the symbol already gives a complete unit.
    expect(finding.evidence.enclosingRange).toBeUndefined();
  });
});
