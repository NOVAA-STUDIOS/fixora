import type { Finding } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { computeVerdict, sliceLines, spliceLines } from '../electron/main/verification/patch.js';

const FILE = ['line1', 'line2', 'line3', 'line4', 'line5'].join('\n');

function finding(overrides: Partial<Finding> & { rule: string; symbol?: string }): Finding {
  return {
    id: `id-${overrides.rule}`,
    source: 'eslint',
    ruleId: overrides.rule,
    severity: 'warning',
    category: 'maintainability',
    location: { file: 'src/x.ts', startLine: 2, startCol: 1, endLine: 2, endCol: 2 },
    message: 'm',
    evidence: {
      ...(overrides.symbol !== undefined
        ? {
            enclosingSymbol: {
              name: overrides.symbol,
              kind: 'function',
              location: { file: 'src/x.ts', startLine: 1, startCol: 1, endLine: 5, endCol: 1 },
            },
          }
        : {}),
      snippet: 's',
      relatedLocations: [],
      toolOutput: {},
    },
    fixable: true,
    confidence: 1,
  };
}

describe('splice / slice', () => {
  it('replaces a 1-based inclusive line range', () => {
    expect(spliceLines(FILE, 2, 3, 'NEW')).toBe(['line1', 'NEW', 'line4', 'line5'].join('\n'));
  });
  it('replaces a range with multi-line content', () => {
    expect(spliceLines(FILE, 2, 2, 'a\nb')).toBe(
      ['line1', 'a', 'b', 'line3', 'line4', 'line5'].join('\n'),
    );
  });
  it('slices a 1-based inclusive range', () => {
    expect(sliceLines(FILE, 2, 3)).toBe('line2\nline3');
  });
});

describe('computeVerdict (ADR-003)', () => {
  const target = finding({ rule: 'no-unused', symbol: 'greet' });

  it('VERIFIED: target resolved, no new findings, syntax ok', () => {
    const report = computeVerdict({
      target,
      originalFindings: [target],
      patchedFindings: [],
      syntaxOk: true,
    });
    expect(report.verdict).toBe('verified');
    expect(report.targetResolved).toBe(true);
    expect(report.newFindingCount).toBe(0);
    expect(report.ran).toContain('syntax');
  });

  it('UNRESOLVED: target still present, nothing new', () => {
    const report = computeVerdict({
      target,
      originalFindings: [target],
      patchedFindings: [target],
      syntaxOk: true,
    });
    expect(report.verdict).toBe('unresolved');
    expect(report.targetResolved).toBe(false);
  });

  it('REGRESSION: fix resolves the target but introduces a new finding', () => {
    const introduced = finding({ rule: 'no-explicit-any', symbol: 'greet' });
    const report = computeVerdict({
      target,
      originalFindings: [target],
      patchedFindings: [introduced],
      syntaxOk: true,
    });
    expect(report.verdict).toBe('regression');
    expect(report.newFindingCount).toBe(1);
  });

  it('REGRESSION: broken syntax, whatever the findings', () => {
    const report = computeVerdict({
      target,
      originalFindings: [target],
      patchedFindings: [],
      syntaxOk: false,
    });
    expect(report.verdict).toBe('regression');
    expect(report.syntaxOk).toBe(false);
  });

  it('does not count a pre-existing finding as a regression', () => {
    const other = finding({ rule: 'pre-existing', symbol: 'other' });
    const report = computeVerdict({
      target,
      originalFindings: [target, other],
      patchedFindings: [other], // target fixed, the unrelated one remains (was already there)
      syntaxOk: true,
    });
    expect(report.verdict).toBe('verified');
    expect(report.newFindingCount).toBe(0);
  });
});
