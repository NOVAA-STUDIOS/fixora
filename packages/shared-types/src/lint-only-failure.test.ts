import { describe, expect, it } from 'vitest';

import type { NewFinding, VerificationReport } from './ai.js';
import { detectLintOnlyFailure, isLintSource } from './lint-only-failure.js';

/**
 * Which rejections earn one more targeted attempt — and, far more importantly, which never do.
 *
 * A lint-only rejection means the patch parses, type-checks and resolves the reported problem, and
 * the only thing between it and Apply is something like `prefer-const`. That is worth one narrow
 * retry. Everything else is not, and the negative cases below are the actual safety argument: a type
 * error, a parse failure, a semgrep finding, or a MIXED failure must never be treated as cosmetic.
 *
 * Nothing here changes a verdict or enables Apply. It only decides whether to spend one more
 * generation before the existing gate has the final word.
 */
function finding(over: Partial<NewFinding> = {}): NewFinding {
  return { source: 'eslint', ruleId: 'prefer-const', line: 12, message: 'msg', ...over };
}

function report(over: Partial<VerificationReport> = {}): VerificationReport {
  return {
    verdict: 'regression',
    targetResolved: true,
    newFindingCount: 1,
    syntaxOk: true,
    ran: ['syntax', 'eslint', 'tsc'],
    newFindings: [finding()],
    ...over,
  };
}

describe('detectLintOnlyFailure — qualifies', () => {
  it('a rejection whose only new findings are ESLint rules', () => {
    const found = detectLintOnlyFailure(report());
    expect(found).not.toBeNull();
    expect(found?.diagnostics).toHaveLength(1);
    expect(found?.reason).toMatch(/type-correct/i);
  });

  it('the rules the user named — require-atomic-updates, no-unused-vars, prefer-const', () => {
    for (const ruleId of ['require-atomic-updates', 'no-unused-vars', 'prefer-const']) {
      expect(detectLintOnlyFailure(report({ newFindings: [finding({ ruleId })] }))).not.toBeNull();
    }
  });

  it('Ruff findings, which are the Python linter equivalent', () => {
    expect(
      detectLintOnlyFailure(report({ newFindings: [finding({ source: 'ruff', ruleId: 'F841' })] })),
    ).not.toBeNull();
  });

  it('several lint findings at once, and names the rules in its reason', () => {
    const found = detectLintOnlyFailure(
      report({
        newFindingCount: 2,
        newFindings: [finding({ ruleId: 'prefer-const' }), finding({ ruleId: 'no-unused-vars' })],
      }),
    );
    expect(found?.diagnostics).toHaveLength(2);
    expect(found?.reason).toContain('prefer-const');
  });
});

describe('detectLintOnlyFailure — never qualifies', () => {
  it('a patch that does not parse, whatever its findings say', () => {
    // Checked before anything else: malformed code is not a lint problem.
    expect(detectLintOnlyFailure(report({ syntaxOk: false }))).toBeNull();
  });

  it('a TYPE error — tsc is a claim about correctness, not style', () => {
    expect(
      detectLintOnlyFailure(
        report({ newFindings: [finding({ source: 'tsc', ruleId: 'TS2322' })] }),
      ),
    ).toBeNull();
  });

  it('a mypy error, for the same reason', () => {
    expect(
      detectLintOnlyFailure(report({ newFindings: [finding({ source: 'mypy' })] })),
    ).toBeNull();
  });

  it('a semgrep finding — frequently security, never cosmetic', () => {
    expect(
      detectLintOnlyFailure(report({ newFindings: [finding({ source: 'semgrep' })] })),
    ).toBeNull();
  });

  it('a go-vet finding — semantic', () => {
    expect(
      detectLintOnlyFailure(report({ newFindings: [finding({ source: 'go-vet' })] })),
    ).toBeNull();
  });

  it('a MIXED failure — one type error makes the whole thing semantic', () => {
    // The lint findings beside a type error are not evidence that the type error is harmless.
    const found = detectLintOnlyFailure(
      report({
        newFindingCount: 2,
        newFindings: [finding({ ruleId: 'prefer-const' }), finding({ source: 'tsc', ruleId: 'TS2322' })],
      }),
    );
    expect(found).toBeNull();
  });

  it('a verified patch — there is nothing to retry', () => {
    expect(detectLintOnlyFailure(report({ verdict: 'verified' }))).toBeNull();
  });

  it('an unresolved verdict — the finding still stands, which is not a lint problem', () => {
    expect(detectLintOnlyFailure(report({ verdict: 'unresolved' }))).toBeNull();
  });

  it('a skipped verdict — no analyzer ran', () => {
    expect(detectLintOnlyFailure(report({ verdict: 'skipped' }))).toBeNull();
  });

  it('a rejection with no evidence — a retry would be a re-roll, not a correction', () => {
    expect(detectLintOnlyFailure(report({ newFindings: [] }))).toBeNull();
    expect(detectLintOnlyFailure(report({ newFindings: undefined }))).toBeNull();
  });
});

describe('isLintSource', () => {
  it('accepts the linters and nothing else', () => {
    expect(isLintSource('eslint')).toBe(true);
    expect(isLintSource('ESLint')).toBe(true);
    expect(isLintSource('ruff')).toBe(true);
    for (const s of ['tsc', 'mypy', 'go-vet', 'semgrep', 'complexity', 'ai', 'json']) {
      expect(isLintSource(s)).toBe(false);
    }
  });
});
