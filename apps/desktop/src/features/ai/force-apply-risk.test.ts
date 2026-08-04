import type { AiProposal, VerificationReport } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { assessForceApplyRisk, riskLabel } from './force-apply-risk.js';

/**
 * The briefing a user reads before overriding the verifier.
 *
 * Force Apply is only defensible if the consent is informed, so what matters here is that each
 * failure class produces an accurate, specific description — a parse failure must never be presented
 * as mild, and a lint warning must never be presented as catastrophic. Inflating low risk trains
 * people to click through warnings; understating high risk is worse.
 *
 * None of this evaluates a gate or enables anything. `evaluateApplyGate` remains the sole authority
 * over Accept, and the write-time guards are untouched.
 */
function report(over: Partial<VerificationReport> = {}): VerificationReport {
  return {
    verdict: 'regression',
    targetResolved: true,
    newFindingCount: 1,
    syntaxOk: true,
    ran: ['syntax', 'eslint', 'tsc'],
    ...over,
  };
}

function proposal(
  verification: VerificationReport,
  repairedCode = 'const a = 1;',
): Extract<AiProposal, { profile: 'repair' }> {
  return {
    profile: 'repair',
    historyId: 'h1',
    repairedCode,
    originalCode: 'const a = 2;',
    rationale: 'r',
    confidence: 0.9,
    target: { file: 'src/a.ts', startLine: 1, endLine: 1, symbolName: null },
    verification,
  };
}

describe('assessForceApplyRisk — a verified patch needs no forcing', () => {
  it('reports verified and offers no consequences', () => {
    const risk = assessForceApplyRisk(proposal(report({ verdict: 'verified', newFindingCount: 0 })));
    expect(risk?.verified).toBe(true);
    expect(risk?.level).toBe('low');
    expect(risk?.consequences).toEqual([]);
  });

  it('treats unresolved and skipped as verified-enough — the gate already enables Accept', () => {
    for (const verdict of ['unresolved', 'skipped'] as const) {
      const risk = assessForceApplyRisk(
        proposal(report({ verdict, targetResolved: false, newFindingCount: 0 })),
      );
      expect(risk?.verified).toBe(true);
    }
  });

  it('returns null when there is no proposal at all', () => {
    expect(assessForceApplyRisk(null)).toBeNull();
  });
});

describe('assessForceApplyRisk — a parse failure is the worst case', () => {
  it('rates it high and says the file will not compile', () => {
    const risk = assessForceApplyRisk(proposal(report({ syntaxOk: false })));
    expect(risk?.level).toBe('high');
    expect(risk?.headline).toMatch(/does not parse/i);
    expect(risk?.consequences.join(' ')).toMatch(/will not compile/i);
  });

  it('quotes the parser location when the verifier gave one', () => {
    const risk = assessForceApplyRisk(
      proposal(
        report({ syntaxOk: false, syntaxError: { line: 42, column: 7, text: "near 'ERROR'" } }),
      ),
    );
    expect(risk?.detail).toContain('42');
    expect(risk?.detail).toContain("near 'ERROR'");
  });

  it('outranks findings — a broken file is not downgraded by its lint count', () => {
    const risk = assessForceApplyRisk(
      proposal(
        report({
          syntaxOk: false,
          newFindings: [{ source: 'eslint', ruleId: 'semi', line: 1, message: 'x' }],
        }),
      ),
    );
    expect(risk?.level).toBe('high');
    expect(risk?.headline).toMatch(/does not parse/i);
  });
});

describe('assessForceApplyRisk — rates each failure class honestly', () => {
  it('a type error is high risk and mentions the build', () => {
    const risk = assessForceApplyRisk(
      proposal(
        report({
          newFindings: [{ source: 'tsc', ruleId: 'TS2322', line: 3, message: 'Type mismatch.' }],
        }),
      ),
    );
    expect(risk?.level).toBe('high');
    expect(risk?.headline).toMatch(/type error/i);
    expect(risk?.consequences.join(' ')).toMatch(/build/i);
  });

  it('a lint warning is LOW risk and says the code parses and type-checks', () => {
    // Overstating this is how warning fatigue starts.
    const risk = assessForceApplyRisk(
      proposal(
        report({
          newFindings: [
            { source: 'eslint', ruleId: 'prefer-const', line: 3, message: 'Use const.' },
          ],
        }),
      ),
    );
    expect(risk?.level).toBe('low');
    expect(risk?.headline).toMatch(/lint warning/i);
    expect(risk?.consequences.join(' ')).toMatch(/parses and type-checks/i);
  });

  it('a semgrep finding is medium and warns it may be a security rule', () => {
    const risk = assessForceApplyRisk(
      proposal(
        report({
          newFindings: [{ source: 'semgrep', ruleId: 'sec.rule', line: 3, message: 'unsafe' }],
        }),
      ),
    );
    expect(risk?.level).toBe('medium');
    expect(risk?.consequences.join(' ')).toMatch(/security/i);
  });

  it('a MIXED failure is rated by its most serious member, not its mildest', () => {
    const risk = assessForceApplyRisk(
      proposal(
        report({
          newFindingCount: 2,
          newFindings: [
            { source: 'eslint', ruleId: 'prefer-const', line: 3, message: 'Use const.' },
            { source: 'tsc', ruleId: 'TS2322', line: 4, message: 'Type mismatch.' },
          ],
        }),
      ),
    );
    expect(risk?.level).toBe('high');
    expect(risk?.headline).toMatch(/type error/i);
  });

  it('an empty patch is high risk — forcing it would delete the target range', () => {
    const risk = assessForceApplyRisk(proposal(report({ verdict: 'verified' }), ''));
    expect(risk?.level).toBe('high');
    expect(risk?.consequences.join(' ')).toMatch(/deleting that code/i);
  });

  it('always gives at least one concrete consequence for a failed patch', () => {
    // "May cause issues" is not consent. Every rejection path must say something specific.
    const cases: VerificationReport[] = [
      report({ syntaxOk: false }),
      report({ newFindings: [{ source: 'tsc', ruleId: 'TS1', line: 1, message: 'm' }] }),
      report({ newFindings: [{ source: 'eslint', ruleId: 'semi', line: 1, message: 'm' }] }),
      report({ newFindings: [{ source: 'go-vet', ruleId: 'v', line: 1, message: 'm' }] }),
      report({}),
    ];
    for (const r of cases) {
      const risk = assessForceApplyRisk(proposal(r));
      expect(risk?.verified).toBe(false);
      expect(risk?.consequences.length).toBeGreaterThan(0);
      expect(risk?.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('riskLabel', () => {
  it('names every level', () => {
    expect(riskLabel('low')).toBe('Low risk');
    expect(riskLabel('medium')).toBe('Medium risk');
    expect(riskLabel('high')).toBe('High risk');
  });
});
