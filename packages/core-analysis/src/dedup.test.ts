import type { Finding } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { dedupeFindings } from './dedup.js';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    source: 'eslint',
    ruleId: 'no-unused-vars',
    severity: 'warning',
    category: 'correctness',
    location: { file: 'src/a.ts', startLine: 10, startCol: 1, endLine: 10, endCol: 20 },
    message: 'x is unused',
    evidence: { snippet: 'const x = 1;', relatedLocations: [], toolOutput: null },
    fixable: false,
    repair: 'ai-required',
    confidence: 0.8,
    ...overrides,
  };
}

describe('dedupeFindings', () => {
  it('same file + line + category from two analyzers collapses to one, keeping the higher confidence', () => {
    const fromEslint = finding({ id: 'e1', source: 'eslint', ruleId: 'no-unused-vars', confidence: 0.8 });
    const fromTsc = finding({ id: 't1', source: 'tsc', ruleId: 'TS6133', confidence: 0.95 });

    const result = dedupeFindings([fromEslint, fromTsc]);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.id).toBe('t1');
    expect(result.duplicatesRemoved).toBe(1);
  });

  it('keeps the first-seen finding on a confidence tie', () => {
    const first = finding({ id: 'first', confidence: 0.9 });
    const second = finding({ id: 'second', source: 'tsc', confidence: 0.9 });

    const result = dedupeFindings([first, second]);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.id).toBe('first');
  });

  it('a different line keeps both findings', () => {
    const a = finding({ id: 'a', location: { file: 'src/a.ts', startLine: 10, startCol: 1, endLine: 10, endCol: 20 } });
    const b = finding({ id: 'b', location: { file: 'src/a.ts', startLine: 11, startCol: 1, endLine: 11, endCol: 20 } });

    const result = dedupeFindings([a, b]);

    expect(result.findings).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it('a different category keeps both findings, even on the same file + line', () => {
    const correctness = finding({ id: 'c', category: 'correctness' });
    const security = finding({ id: 's', category: 'security' });

    const result = dedupeFindings([correctness, security]);

    expect(result.findings).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it('a different file keeps both findings, even at the same line + category', () => {
    const a = finding({ id: 'a', location: { file: 'src/a.ts', startLine: 10, startCol: 1, endLine: 10, endCol: 20 } });
    const b = finding({ id: 'b', location: { file: 'src/b.ts', startLine: 10, startCol: 1, endLine: 10, endCol: 20 } });

    const result = dedupeFindings([a, b]);

    expect(result.findings).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it('three-way duplicate collapses to one and reports 2 removed', () => {
    const findings = [
      finding({ id: 'a', confidence: 0.5 }),
      finding({ id: 'b', confidence: 0.9 }),
      finding({ id: 'c', confidence: 0.7 }),
    ];

    const result = dedupeFindings(findings);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.id).toBe('b');
    expect(result.duplicatesRemoved).toBe(2);
  });

  it('empty input', () => {
    const result = dedupeFindings([]);
    expect(result.findings).toHaveLength(0);
    expect(result.duplicatesRemoved).toBe(0);
  });
});
