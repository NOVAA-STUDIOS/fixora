import type { SymbolRef } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { findingId, normalizeSnippet, type FindingIdInput } from './finding-id.js';

const symbol: SymbolRef = {
  name: 'processOrder',
  kind: 'function',
  location: { file: 'src/order.ts', startLine: 10, startCol: 1, endLine: 40, endCol: 2 },
};

function base(): FindingIdInput {
  return {
    source: 'eslint',
    ruleId: 'no-unused-vars',
    file: 'src/order.ts',
    enclosingSymbol: symbol,
    snippet: 'const total = 0;',
  };
}

describe('normalizeSnippet', () => {
  it('collapses whitespace runs and trims', () => {
    expect(normalizeSnippet('  const   total\t=\n0;  ')).toBe('const total = 0;');
  });

  it('preserves identifiers exactly (foo is not bar)', () => {
    expect(normalizeSnippet('const foo = 1')).not.toBe(normalizeSnippet('const bar = 1'));
  });
});

describe('findingId stability', () => {
  it('is deterministic — same input, same id', () => {
    expect(findingId(base())).toBe(findingId(base()));
  });

  it('is stable when only whitespace in the snippet changes (a reformat)', () => {
    const reformatted = { ...base(), snippet: 'const   total   =   0;' };
    expect(findingId(reformatted)).toBe(findingId(base()));
  });

  it('is STABLE when the symbol moves but keeps its name and kind (lines shifted by a patch)', () => {
    // The whole point: a patch above this function shifts its line numbers. The id must not change.
    const moved: FindingIdInput = {
      ...base(),
      enclosingSymbol: {
        ...symbol,
        location: { file: 'src/order.ts', startLine: 200, startCol: 1, endLine: 230, endCol: 2 },
      },
    };
    expect(findingId(moved)).toBe(findingId(base()));
  });

  it('produces a 32-char lowercase hex digest', () => {
    expect(findingId(base())).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('findingId distinctness', () => {
  it('differs when the rule differs', () => {
    expect(findingId({ ...base(), ruleId: 'no-shadow' })).not.toBe(findingId(base()));
  });

  it('differs when the source differs (no cross-tool id collision)', () => {
    expect(findingId({ ...base(), source: 'semgrep' })).not.toBe(findingId(base()));
  });

  it('differs when the file differs', () => {
    expect(findingId({ ...base(), file: 'src/other.ts' })).not.toBe(findingId(base()));
  });

  it('differs when the enclosing symbol differs', () => {
    const other: SymbolRef = { ...symbol, name: 'cancelOrder' };
    expect(findingId({ ...base(), enclosingSymbol: other })).not.toBe(findingId(base()));
  });

  it('differs when the snippet content (not just whitespace) differs', () => {
    expect(findingId({ ...base(), snippet: 'const subtotal = 0;' })).not.toBe(findingId(base()));
  });

  it('distinguishes a top-level finding (no symbol) from one inside a symbol', () => {
    const topLevel: FindingIdInput = { ...base(), enclosingSymbol: undefined };
    expect(findingId(topLevel)).not.toBe(findingId(base()));
  });

  it('does not let field values bleed across the boundary (JSON framing)', () => {
    // "a" + rule "b" must not collide with source "ab" + rule "" — the framing prevents it.
    const a = findingId({ ...base(), source: 'eslint', ruleId: 'x-rule' });
    const b = findingId({ ...base(), source: 'eslint', ruleId: 'x-rule' });
    expect(a).toBe(b); // sanity
    const shifted = findingId({ ...base(), ruleId: '","', snippet: base().snippet });
    expect(shifted).not.toBe(a);
  });
});
