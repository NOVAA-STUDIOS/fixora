import { describe, expect, it } from 'vitest';

import { FindingSchema, LocationSchema, type Finding } from './analysis.js';

function validFinding(): Finding {
  return {
    id: 'a'.repeat(32),
    source: 'eslint',
    ruleId: 'no-unused-vars',
    severity: 'warning',
    category: 'correctness',
    location: { file: 'src/a.ts', startLine: 3, startCol: 7, endLine: 3, endCol: 12 },
    message: "'total' is assigned a value but never used.",
    evidence: { snippet: 'const total = 0;', relatedLocations: [], toolOutput: { raw: true } },
    fixable: true,
    repair: 'ai-required',
    confidence: 1,
  };
}

describe('FindingSchema', () => {
  it('accepts a well-formed deterministic finding', () => {
    expect(FindingSchema.parse(validFinding())).toEqual(validFinding());
  });

  it('accepts an optional enclosing symbol in the evidence', () => {
    const f = validFinding();
    f.evidence.enclosingSymbol = {
      name: 'load',
      kind: 'function',
      location: { file: 'src/a.ts', startLine: 1, startCol: 1, endLine: 5, endCol: 2 },
    };
    expect(FindingSchema.parse(f)).toEqual(f);
  });

  it('rejects an out-of-range confidence (a probability, not a score)', () => {
    expect(() => FindingSchema.parse({ ...validFinding(), confidence: 1.5 })).toThrow();
  });

  it('rejects an unknown source (the source set is closed)', () => {
    expect(() => FindingSchema.parse({ ...validFinding(), source: 'flake8' })).toThrow();
  });

  it('rejects an empty id — a finding must be identifiable', () => {
    expect(() => FindingSchema.parse({ ...validFinding(), id: '' })).toThrow();
  });

  it('rejects a non-positive line (locations are 1-based)', () => {
    expect(() =>
      LocationSchema.parse({ file: 'a.ts', startLine: 0, startCol: 1, endLine: 1, endCol: 1 }),
    ).toThrow();
  });
});
