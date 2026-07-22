import type { Language } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import type { RepairScope } from '../analyzer.js';
import { parse } from '../parser/tree-sitter.js';

import { collectScopes, smallestScopeContaining } from './scope-selector.js';

/**
 * Repair Context Engine v2 — the AST scope selector.
 *
 * For a finding in each syntactic construct the brief lists, the selector must return the SMALLEST
 * scope that (a) parses on its own and (b) can be spliced back without breaking the file. These pin
 * both properties for every category, and roll up the metrics the brief asks for: parser-rejection
 * rate (a selected scope that does not independently parse) and average scope size.
 */

async function parses(source: string, language: Language, filePath: string): Promise<boolean> {
  const tree = await parse(language, source, filePath);
  try {
    return !tree.root.hasError;
  } finally {
    tree.dispose();
  }
}

async function scopeFor(
  source: string,
  language: Language,
  filePath: string,
  line: number,
): Promise<{ scope: RepairScope; text: string }> {
  const tree = await parse(language, source, filePath);
  let scopes;
  try {
    scopes = collectScopes(tree.root, language);
  } finally {
    tree.dispose();
  }
  const scope = smallestScopeContaining(scopes, line);
  expect(scope, `a scope should contain line ${String(line)}`).not.toBeNull();
  const text = source
    .split('\n')
    .slice(scope!.startLine - 1, scope!.endLine)
    .join('\n');
  return { scope: scope!, text };
}

/** file → [source, language, filePath, findingLine, expectedLevel]. Sizes feed the metrics rollup. */
const CASES: {
  name: string;
  source: string;
  language: Language;
  filePath: string;
  line: number;
  level: RepairScope['level'];
}[] = [
  {
    name: 'expression',
    source: 'export const total = price + tax * qty;\n',
    language: 'typescript',
    filePath: 'e.ts',
    line: 1,
    level: 'declaration',
  },
  {
    name: 'statement',
    source: 'function f(a: number, b: number) {\n  doThing(a, b);\n}\n',
    language: 'typescript',
    filePath: 's.ts',
    line: 2,
    level: 'statement',
  },
  {
    name: 'declaration',
    source: 'type Config = {\n  retries: number;\n};\n',
    language: 'typescript',
    filePath: 'd.ts',
    line: 2,
    level: 'declaration',
  },
  {
    name: 'function',
    source: 'export function calc(): number {\n  return 1;\n}\n',
    language: 'typescript',
    filePath: 'fn.ts',
    line: 1,
    level: 'declaration', // export_statement wraps the function
  },
  {
    name: 'class',
    source: 'class Box {\n  size: number = 0;\n  grow(): void {}\n}\n',
    language: 'typescript',
    filePath: 'c.ts',
    line: 2, // a class field — not a splice-safe scope on its own, so the class is selected
    level: 'class',
  },
  {
    name: 'imports',
    source: 'import { readFile } from "node:fs";\n\nreadFile("x");\n',
    language: 'typescript',
    filePath: 'i.ts',
    line: 1,
    level: 'statement',
  },
  {
    name: 'object-literal',
    source: 'interface S {\n  count: number;\n}\nexport const s: S = {\n  count: "x",\n};\n',
    language: 'typescript',
    filePath: 'o.ts',
    line: 5, // the `count: "x"` property — grounds on the whole `export const s = {…}`
    level: 'declaration',
  },
  {
    name: 'array-literal',
    source: 'export const xs: number[] = [\n  1,\n  "two",\n  3,\n];\n',
    language: 'typescript',
    filePath: 'a.ts',
    line: 3, // the bad element — grounds on the whole declaration
    level: 'declaration',
  },
  {
    name: 'jsx',
    source: 'export const V = () => <div className="a">{x}</div>;\n',
    language: 'typescript',
    filePath: 'v.tsx',
    line: 1,
    level: 'declaration',
  },
  {
    name: 'react-hooks',
    source:
      'import { useEffect } from "react";\n\nexport function C({ start }: { start: number }) {\n  useEffect(() => {\n    setCount(start);\n  });\n  return null;\n}\n',
    language: 'typescript',
    filePath: 'C.tsx',
    line: 4, // the useEffect call — grounds on that single call statement, not the whole component
    level: 'statement',
  },
  {
    name: 'python-statement',
    source: 'def f(n):\n    total = n * 2\n    return n\n',
    language: 'python',
    filePath: 'p.py',
    line: 2,
    level: 'statement',
  },
];

describe('scope selector — every construct grounds on a compilable scope', () => {
  for (const c of CASES) {
    it(`${c.name}: selects a ${c.level}-level scope that parses independently`, async () => {
      const { scope, text } = await scopeFor(c.source, c.language, c.filePath, c.line);
      expect(scope.level).toBe(c.level);
      // The core guarantee: the selected scope compiles on its own.
      expect(await parses(text, c.language, c.filePath), `scope text must parse:\n${text}`).toBe(
        true,
      );
      // And it is not the whole file unless the file is a single statement.
      const fileLines = c.source.replace(/\n$/, '').split('\n').length;
      expect(scope.endLine - scope.startLine + 1).toBeLessThanOrEqual(fileLines);
    });
  }

  it('metrics: 0% parser-rejection rate, and average scope stays small', async () => {
    let totalLines = 0;
    let rejected = 0;
    for (const c of CASES) {
      const { scope, text } = await scopeFor(c.source, c.language, c.filePath, c.line);
      totalLines += scope.endLine - scope.startLine + 1;
      if (!(await parses(text, c.language, c.filePath))) rejected += 1;
    }
    const avg = totalLines / CASES.length;
    // Every selected scope parses — the whole point of the selector.
    expect(rejected).toBe(0);
    // "Minimise unnecessary code generation": the average scope is a handful of lines, not a module.
    expect(avg).toBeLessThan(6);
    console.warn(
      `[scope-selector] cases=${String(CASES.length)} parser-rejection-rate=${String(rejected)}/${String(CASES.length)} avg-scope-lines=${avg.toFixed(1)}`,
    );
  });

  it('does not over-select: a lone top-level statement grounds on the statement, not the module', async () => {
    const { scope } = await scopeFor('const a: number = 1;\n', 'typescript', 'm.ts', 1);
    expect(scope.level).toBe('declaration');
    expect(scope).toEqual({ startLine: 1, endLine: 1, level: 'declaration' });
  });

  it('returns null for a line inside no scope (a blank line), so the caller falls back to the finding line', async () => {
    const tree = await parse('typescript', 'const a = 1;\n\nconst b = 2;\n', 't.ts');
    const scopes = collectScopes(tree.root, 'typescript');
    tree.dispose();
    expect(smallestScopeContaining(scopes, 2)).toBeNull(); // the blank line 2
  });
});
