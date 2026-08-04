import type { Finding } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { computeVerdict, verificationSignature } from '../electron/main/verification/patch.js';

/**
 * Verification identity under a line shift — the defect that disabled Apply for correct repairs.
 *
 * `verificationSignature` keyed a finding on its enclosing symbol, falling back to
 * `line:<startLine>` when there was none. That fallback made identity POSITIONAL, so a patch which
 * changed the file's line count renamed every symbol-less finding below it:
 *
 *     before:  eslint:no-console:line:20
 *     after :  eslint:no-console:line:21   <- counted as a NEW problem
 *
 * `computeVerdict` then saw a signature absent from the baseline, returned `regression`, and
 * `evaluateApplyGate` disabled Apply — over a finding the patch never touched. Findings routinely
 * have no enclosing symbol (CSS rules, JSON members, top-level statements, config files), and every
 * prerequisite fix that scope escalation emits adds a line, so this fired constantly.
 *
 * Identity is now the CODE the finding is about. These pin both halves: a moved finding is the same
 * problem, and a genuinely introduced one is still caught.
 */

function finding(over: {
  line: number;
  rule?: string;
  symbol?: string;
  snippet?: string;
  source?: Finding['source'];
}): Finding {
  return {
    id: `id-${String(over.line)}`,
    source: over.source ?? 'eslint',
    ruleId: over.rule ?? 'no-console',
    severity: 'warning',
    category: 'maintainability',
    location: { file: 'a.ts', startLine: over.line, startCol: 1, endLine: over.line, endCol: 2 },
    message: 'message',
    evidence: {
      ...(over.symbol === undefined
        ? {}
        : {
            enclosingSymbol: {
              name: over.symbol,
              kind: 'function' as const,
              location: { file: 'a.ts', startLine: 1, startCol: 1, endLine: 99, endCol: 1 },
            },
          }),
      snippet: over.snippet ?? "console.log('hello');",
      relatedLocations: [],
      toolOutput: {},
    },
    fixable: true,
    repair: 'ai-required',
    confidence: 1,
  };
}

const TARGET = finding({ line: 5, rule: 'target-rule', symbol: 'fn', snippet: 'const a = 1;' });

describe('verificationSignature — identity survives a line shift', () => {
  it('a symbol-less finding keeps its identity when its code moves', () => {
    const before = verificationSignature(finding({ line: 20 }));
    const after = verificationSignature(finding({ line: 21 }));
    expect(after).toBe(before);
    // And it is keyed on content, not position — the old `line:N` form is gone.
    expect(before).not.toMatch(/line:\d+/);
    expect(before).toContain(':code:');
  });

  it('different code under the same rule is a DIFFERENT problem', () => {
    const a = verificationSignature(finding({ line: 20, snippet: "console.log('a');" }));
    const b = verificationSignature(finding({ line: 20, snippet: "console.log('b');" }));
    expect(a).not.toBe(b);
  });

  it('re-indentation does not change identity — reindentToMatch does that routinely', () => {
    const flush = verificationSignature(finding({ line: 20, snippet: "console.log('x');" }));
    const indented = verificationSignature(finding({ line: 20, snippet: "    console.log('x');" }));
    expect(indented).toBe(flush);
  });

  it('still separates rules and sources that share a snippet', () => {
    const eslint = verificationSignature(finding({ line: 3, rule: 'no-console' }));
    const other = verificationSignature(finding({ line: 3, rule: 'no-debugger' }));
    const ruff = verificationSignature(finding({ line: 3, source: 'ruff' }));
    expect(new Set([eslint, other, ruff]).size).toBe(3);
  });

  it('falls back to position only when there is no content at all', () => {
    expect(verificationSignature(finding({ line: 7, snippet: '   ' }))).toContain('line:7');
  });

  it('prefers the enclosing symbol when one exists — unchanged behaviour', () => {
    expect(verificationSignature(finding({ line: 20, symbol: 'greet' }))).toBe(
      'eslint:no-console:greet',
    );
  });
});

describe('computeVerdict — a shifted finding is not a regression', () => {
  it('verifies a patch that merely moved an untouched problem down a line', () => {
    const report = computeVerdict({
      target: TARGET,
      originalFindings: [TARGET, finding({ line: 20 })],
      // The patch added a line, so the untouched finding is reported one line lower.
      patchedFindings: [finding({ line: 21 })],
      syntaxOk: true,
    });
    expect(report.verdict).toBe('verified');
    expect(report.newFindingCount).toBe(0);
    expect(report.newFindings).toBeUndefined();
  });

  it('still reports a REAL new problem introduced by the patch', () => {
    const report = computeVerdict({
      target: TARGET,
      originalFindings: [TARGET, finding({ line: 20 })],
      patchedFindings: [
        finding({ line: 21 }),
        finding({ line: 30, rule: 'no-debugger', snippet: 'debugger;' }),
      ],
      syntaxOk: true,
    });
    expect(report.verdict).toBe('regression');
    expect(report.newFindingCount).toBe(1);
    expect(report.newFindings?.[0]?.ruleId).toBe('no-debugger');
  });

  it('catches a new problem even when the rule already existed elsewhere', () => {
    // Same rule, different code — the patch introduced a second `console.log`, which is a genuine
    // regression and must not be masked by content-keyed identity.
    const report = computeVerdict({
      target: TARGET,
      originalFindings: [TARGET, finding({ line: 20, snippet: "console.log('a');" })],
      patchedFindings: [
        finding({ line: 21, snippet: "console.log('a');" }),
        finding({ line: 25, snippet: "console.log('NEW');" }),
      ],
      syntaxOk: true,
    });
    expect(report.verdict).toBe('regression');
    expect(report.newFindingCount).toBe(1);
  });

  it('a parse failure still regresses regardless of signatures', () => {
    const report = computeVerdict({
      target: TARGET,
      originalFindings: [TARGET],
      patchedFindings: [],
      syntaxOk: false,
    });
    expect(report.verdict).toBe('regression');
    expect(report.note).toMatch(/does not parse/i);
  });

  it('an unresolved target is still reported as unresolved, not verified', () => {
    const report = computeVerdict({
      target: TARGET,
      originalFindings: [TARGET],
      patchedFindings: [TARGET],
      syntaxOk: true,
    });
    expect(report.verdict).toBe('unresolved');
  });
});
