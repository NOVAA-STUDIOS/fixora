import type { Finding } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { computeVerdict, sliceLines, spliceLines } from '../electron/main/verification/patch.js';

const FILE = ['line1', 'line2', 'line3', 'line4', 'line5'].join('\n');

function finding(
  overrides: Partial<Finding> & { rule: string; symbol?: string; severity?: Finding['severity'] },
): Finding {
  return {
    id: `id-${overrides.rule}`,
    source: 'eslint',
    ruleId: overrides.rule,
    severity: overrides.severity ?? 'warning',
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
    repair: 'ai-required',
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

  /**
   * P0.2 regression: applying a repair (always LF from the model) into a CRLF (Windows) file must not
   * leave a lone-LF line behind — a mixed-ending file is corruption every tool flags. The splice
   * normalises to the file's dominant ending.
   */
  it('keeps a CRLF file uniformly CRLF when the LF replacement is spliced in', () => {
    const crlf = 'const a = 1;\r\nconst b = 2;\r\nconst c = 3;\r\n';
    const out = spliceLines(crlf, 2, 2, 'const b = 20;'); // model reply is LF
    expect(out).toBe('const a = 1;\r\nconst b = 20;\r\nconst c = 3;\r\n');
    // No lone LF survives.
    expect(/(?<!\r)\n/.test(out)).toBe(false);
  });

  it('keeps an LF file LF (no stray CRLF introduced)', () => {
    const lf = 'a\nb\nc\n';
    expect(spliceLines(lf, 2, 2, 'B')).toBe('a\nB\nc\n');
    expect(out_has_cr(spliceLines(lf, 2, 2, 'B'))).toBe(false);
  });

  it('slices identically whether the file is CRLF or LF, so the stale-range check is ending-agnostic', () => {
    const lf = 'line1\nline2\nline3\n';
    const crlf = 'line1\r\nline2\r\nline3\r\n';
    expect(sliceLines(crlf, 2, 3)).toBe(sliceLines(lf, 2, 3));
    expect(sliceLines(crlf, 2, 3)).toBe('line2\nline3'); // no \r leaks into the compared text
  });
});

function out_has_cr(s: string): boolean {
  return s.includes('\r');
}

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

/**
 * Proceed Mode (P2.1) reuses computeVerdict with `target: null` — there is no finding to resolve, so
 * the verdict reduces to "parses + introduces no new problems". These tests pin the edit-mode branch
 * AND that the repair path (target present) is completely unchanged.
 */
describe('computeVerdict — edit mode (target: null)', () => {
  it('VERIFIED when the edit parses and introduces no new findings', () => {
    const pre = finding({ rule: 'pre-existing', symbol: 'other' });
    const report = computeVerdict({
      target: null,
      originalFindings: [pre],
      patchedFindings: [pre], // unchanged baseline finding is not new
      syntaxOk: true,
    });
    expect(report.verdict).toBe('verified');
    expect(report.targetResolved).toBe(true); // vacuously — nothing to resolve
    expect(report.newFindingCount).toBe(0);
    expect(report.diagnostics?.targetSignature).toBe('(edit — no target finding)');
    expect(report.diagnostics?.targetSeverity).toBe('n/a');
  });

  it('REGRESSION when the edit introduces a new finding', () => {
    const introduced = finding({ rule: 'no-explicit-any', symbol: 'greet' });
    const report = computeVerdict({
      target: null,
      originalFindings: [],
      patchedFindings: [introduced],
      syntaxOk: true,
    });
    expect(report.verdict).toBe('regression');
    expect(report.newFindingCount).toBe(1);
    expect(report.note).toContain('The edit introduces');
  });

  it('REGRESSION when the edit does not parse', () => {
    const report = computeVerdict({
      target: null,
      originalFindings: [],
      patchedFindings: [],
      syntaxOk: false,
    });
    expect(report.verdict).toBe('regression');
  });

  it('never produces UNRESOLVED in edit mode (there is no target to leave unresolved)', () => {
    const report = computeVerdict({
      target: null,
      originalFindings: [],
      patchedFindings: [],
      syntaxOk: true,
    });
    expect(report.verdict).toBe('verified');
  });
});

/**
 * Severity parity.
 *
 * A user reported that Apply worked for `error` findings but not for `warning` ones. The Apply
 * button's only gate is `verdict === 'regression'`, so if that were true the verdict itself would
 * have to depend on severity — and it must not. Whether a patch is safe to apply is a property of
 * the *patch* (does it parse, does it introduce new problems, does it fix the thing), never of how
 * loudly the original problem was reported.
 *
 * These run the identical scenario at each severity and assert the verdicts are indistinguishable.
 * If anyone ever introduces a severity branch into the verification pipeline, this fails.
 */
describe('computeVerdict is independent of severity', () => {
  const SEVERITIES: Finding['severity'][] = ['error', 'warning', 'info'];

  function scenario(severity: Finding['severity'], kind: 'clean' | 'regression' | 'unresolved') {
    const target = finding({ rule: 'target-rule', symbol: 'fn', severity });
    const originalFindings = [target];
    const patchedFindings =
      kind === 'clean'
        ? []
        : kind === 'unresolved'
          ? [target]
          : [finding({ rule: 'brand-new-rule', symbol: 'fn', severity })];
    return computeVerdict({ target, originalFindings, patchedFindings, syntaxOk: true });
  }

  it('returns `verified` for a clean patch at every severity', () => {
    const verdicts = SEVERITIES.map((sev) => scenario(sev, 'clean').verdict);
    expect(verdicts).toEqual(['verified', 'verified', 'verified']);
  });

  it('returns `regression` for a patch that adds a problem, at every severity', () => {
    const verdicts = SEVERITIES.map((sev) => scenario(sev, 'regression').verdict);
    expect(verdicts).toEqual(['regression', 'regression', 'regression']);
  });

  it('returns `unresolved` when the fix does not take, at every severity', () => {
    const verdicts = SEVERITIES.map((sev) => scenario(sev, 'unresolved').verdict);
    expect(verdicts).toEqual(['unresolved', 'unresolved', 'unresolved']);
  });

  it('returns `regression` on broken syntax regardless of severity', () => {
    for (const severity of SEVERITIES) {
      const target = finding({ rule: 'r', symbol: 'fn', severity });
      const report = computeVerdict({
        target,
        originalFindings: [target],
        patchedFindings: [],
        syntaxOk: false,
      });
      expect(report.verdict).toBe('regression');
    }
  });

  it('differs between an error and a warning in exactly one place: the recorded label', () => {
    // The strongest form of the assertion. The report is compared whole, not just the verdict, so
    // severity cannot leak into targetResolved, newFindingCount, syntaxOk, the tool list, the note
    // or the signature sets.
    //
    // `diagnostics.targetSeverity` is the single permitted difference, and it exists precisely so
    // this claim is checkable at runtime: it records what the severity WAS without letting it
    // participate in the decision. Strip it and the two reports must be indistinguishable.
    const asError = scenario('error', 'clean');
    const asWarning = scenario('warning', 'clean');

    expect(asError.diagnostics?.targetSeverity).toBe('error');
    expect(asWarning.diagnostics?.targetSeverity).toBe('warning');

    const withoutRecordedSeverity = (r: typeof asError): unknown => ({
      ...r,
      diagnostics: { ...r.diagnostics, targetSeverity: '<recorded-only>' },
    });
    expect(withoutRecordedSeverity(asWarning)).toEqual(withoutRecordedSeverity(asError));
  });
});

/**
 * Apply's enablement rule, stated as a test so it cannot drift back into severity.
 *
 * The UI disables Apply on exactly one condition: `verdict === 'regression'`. This encodes the
 * product rule the user asked for — a verified repair is applicable no matter what severity the
 * original finding carried.
 */
describe('Apply enablement follows the verdict, not the finding', () => {
  const applyEnabled = (verdict: string): boolean => verdict !== 'regression';

  it('enables Apply for a verified repair at any severity', () => {
    for (const severity of ['error', 'warning', 'info'] as Finding['severity'][]) {
      const target = finding({ rule: 'r', symbol: 'fn', severity });
      const report = computeVerdict({
        target,
        originalFindings: [target],
        patchedFindings: [],
        syntaxOk: true,
      });
      expect(report.verdict).toBe('verified');
      expect(applyEnabled(report.verdict)).toBe(true);
    }
  });

  it('disables Apply for an invalid patch at any severity', () => {
    for (const severity of ['error', 'warning', 'info'] as Finding['severity'][]) {
      const target = finding({ rule: 'r', symbol: 'fn', severity });
      const report = computeVerdict({
        target,
        originalFindings: [target],
        patchedFindings: [],
        syntaxOk: false,
      });
      expect(applyEnabled(report.verdict)).toBe(false);
    }
  });
});
