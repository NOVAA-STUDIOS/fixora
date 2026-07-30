import { describe, expect, it } from 'vitest';

import type { RepairScope } from '../analyzer.js';
import { parse } from '../parser/tree-sitter.js';

import {
  isDelimiterRule,
  outermostConstructContaining,
  outermostScopeContaining,
} from './balanced-scope.js';

/**
 * Root Cause B2 — delimiter-class findings, and ONLY those, get a wider repair target.
 *
 * The defect being fixed: an unbalanced delimiter is reported where the parser gave up, not where the
 * structure broke, so the smallest containing scope excludes the defect and NO in-scope patch can make
 * the file parse. Widening a splice range widens what a wrong patch can damage, so the narrowness of
 * every other class is a safety property and is pinned here as hard as the widening itself.
 */
describe('isDelimiterRule — the permitted set is explicit and narrow', () => {
  it('covers the grammar validators and the syntactic tool diagnostics', () => {
    for (const rule of ['css-syntax', 'html-syntax', 'json-parse', 'TS1005', 'TS1128', 'E999']) {
      expect(isDelimiterRule(rule), rule).toBe(true);
    }
  });

  it('excludes every ordinary finding class — these keep the narrow scope', () => {
    for (const rule of [
      'prefer-const',
      'no-unused-vars',
      'TS2322', // type mismatch
      'TS2304', // undefined name — handled by symbol resolution, NOT by widening
      'F821',
      'B006',
      'complexity',
      'css-missing-semicolon', // has a deterministic autofix; needs no widening
    ]) {
      expect(isDelimiterRule(rule), rule).toBe(false);
    }
  });
});

describe('outermostConstructContaining', () => {
  it('returns the enclosing rule for a CSS error reported inside a nested rule', async () => {
    // Measured: an unclosed `.card {` is reported at line 5 — a DIFFERENT, valid rule. The innermost
    // construct there is that valid rule; the outermost is the broken one.
    const src = '.card {\n  color: #333;\n\n.other { color: red; }\n';
    const tree = await parse('css', src, 'a.css');
    try {
      expect(outermostConstructContaining(tree.root, 4)).toEqual({ startLine: 1, endLine: 4 });
    } finally {
      tree.dispose();
    }
  });

  it('falls back to the nearest preceding construct when the error is past every node', async () => {
    // The signature of an unterminated construct: the parser gives up at EOF, so the reported line
    // can sit beyond every node's range. JSON reports line 4 while the object ends at line 3.
    const src = '{\n  "a": 1,\n  "b": 2\n';
    const tree = await parse('json', src, 'a.json');
    try {
      const range = outermostConstructContaining(tree.root, 4);
      expect(range).not.toBeNull();
      expect(range?.startLine).toBe(1);
    } finally {
      tree.dispose();
    }
  });

  it('is bounded to ONE top-level construct, never the whole file', async () => {
    const src = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';
    const tree = await parse('typescript', src, 'a.ts');
    try {
      // Line 2 belongs to its own statement, not to the file.
      expect(outermostConstructContaining(tree.root, 2)).toEqual({ startLine: 2, endLine: 2 });
    } finally {
      tree.dispose();
    }
  });

  it('returns null for an empty tree rather than inventing a range', async () => {
    const tree = await parse('css', '', 'a.css');
    try {
      expect(outermostConstructContaining(tree.root, 1)).toBeNull();
    } finally {
      tree.dispose();
    }
  });
});

describe('outermostScopeContaining', () => {
  const scopes: RepairScope[] = [
    { startLine: 1, endLine: 3, level: 'declaration' },
    { startLine: 2, endLine: 2, level: 'declaration' },
    { startLine: 3, endLine: 3, level: 'statement' },
  ];

  it('picks the WIDEST containing scope — the counterpart of smallestScopeContaining', () => {
    // Measured on a TS function missing its `}`: the smallest scope at line 2 is 2-2, which excludes
    // the missing brace. The widest is 1-3, which contains it.
    expect(outermostScopeContaining(scopes, 2)).toEqual({
      startLine: 1,
      endLine: 3,
      level: 'declaration',
    });
  });

  it('ignores scopes that do not contain the line', () => {
    expect(
      outermostScopeContaining([{ startLine: 5, endLine: 9, level: 'function' }], 2),
    ).toBeNull();
  });

  it('returns null when there are no scopes at all', () => {
    expect(outermostScopeContaining([], 1)).toBeNull();
  });
});
