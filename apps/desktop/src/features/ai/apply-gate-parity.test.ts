import type { AiProposal, VerificationReport } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { evaluateApplyGate } from './apply-diagnostics.js';

/**
 * Apply-gate parity, and the audit question it answers: *where exactly does Apply become disabled?*
 *
 * The answer is one place — `evaluateApplyGate`, in the renderer — and it is a pure function of the
 * verification report. `ai-service.ts` mirrors that decision into its trace log so a disabled Apply
 * can be explained without a debugger. A mirror that drifts is worse than no mirror, because it would
 * send whoever reads the log looking in the wrong stage, so this pins the two together.
 *
 * It also enumerates every disable path, which is the audit's real question: Apply is disabled by an
 * empty patch, a parser failure, or a regression — and by nothing else. `unresolved` and `skipped`
 * both ENABLE, deliberately: a patch that does not fix the finding but breaks nothing is the user's
 * call to make, and a check that could not run is an absence of evidence, not evidence of a fault.
 */

/** The mirror, copied verbatim from `ai-service.ts`. If it drifts from the gate, these fail. */
function tracedApplyEnabled(repairedCode: string, report: VerificationReport): boolean {
  return repairedCode.length > 0 && report.syntaxOk && report.verdict !== 'regression';
}

function report(over: Partial<VerificationReport> = {}): VerificationReport {
  return {
    verdict: 'verified',
    targetResolved: true,
    newFindingCount: 0,
    syntaxOk: true,
    ran: ['syntax', 'eslint'],
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
    target: { file: 'a.ts', startLine: 1, endLine: 1, symbolName: null },
    verification,
  };
}

const CASES: { name: string; report: VerificationReport; code?: string; enabled: boolean }[] = [
  { name: 'verified', report: report(), enabled: true },
  {
    name: 'unresolved — harmless, so the user decides',
    report: report({ verdict: 'unresolved', targetResolved: false }),
    enabled: true,
  },
  {
    name: 'skipped — no analyzer ran, which is not a failure',
    report: report({ verdict: 'skipped', targetResolved: false }),
    enabled: true,
  },
  {
    name: 'regression — a NEW problem was introduced',
    report: report({ verdict: 'regression', newFindingCount: 1 }),
    enabled: false,
  },
  {
    name: 'parser failure',
    report: report({ verdict: 'regression', syntaxOk: false }),
    enabled: false,
  },
  { name: 'empty patch', report: report(), code: '', enabled: false },
];

describe('Apply gate — every disable path, and nothing else', () => {
  for (const c of CASES) {
    it(`${c.name} -> Apply ${c.enabled ? 'ENABLED' : 'disabled'}`, () => {
      const gate = evaluateApplyGate(proposal(c.report, c.code));
      expect(gate.enabled).toBe(c.enabled);
    });

    it(`${c.name} -> the trace log agrees with the gate`, () => {
      const code = c.code ?? 'const a = 1;';
      expect(tracedApplyEnabled(code, c.report)).toBe(
        evaluateApplyGate(proposal(c.report, c.code)).enabled,
      );
    });
  }

  it('a rejected repair always carries a reason — never a bare refusal', () => {
    for (const c of CASES.filter((x) => !x.enabled)) {
      const gate = evaluateApplyGate(proposal(c.report, c.code));
      expect(gate.reason).toBeTruthy();
      expect(gate.explanation.length).toBeGreaterThan(0);
    }
  });

  it('a formatter warning never disables Apply on its own', () => {
    // Formatting is a preference, not a correctness gate — refusing a correct fix over it would be
    // the pipeline overreaching.
    const gate = evaluateApplyGate(
      proposal(report({ formatter: { ran: true, ok: false, formatter: 'prettier', message: 'x' } })),
    );
    expect(gate.enabled).toBe(true);
  });
});
