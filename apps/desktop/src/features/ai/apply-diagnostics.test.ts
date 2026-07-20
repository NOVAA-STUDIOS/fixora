import type { AiProposal, Verdict } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { evaluateApplyGate, rootCauseOf, type ApplyAttempt } from './apply-diagnostics.js';

type Repair = Extract<AiProposal, { profile: 'repair' }>;

function proposal(over: {
  verdict: Verdict;
  severity?: string;
  code?: string;
  newFindingCount?: number;
  syntaxOk?: boolean;
}): Repair {
  return {
    profile: 'repair',
    target: { file: 'src/a.ts', startLine: 1, endLine: 3, symbolName: 'fn' },
    originalCode: 'old();',
    repairedCode: over.code ?? 'new();',
    rationale: 'r',
    confidence: 0.9,
    historyId: 'h1',
    verification: {
      verdict: over.verdict,
      targetResolved: over.verdict === 'verified',
      newFindingCount: over.newFindingCount ?? 0,
      syntaxOk: over.syntaxOk ?? true,
      ran: ['syntax', 'eslint'],
      diagnostics: {
        targetSignature: 'eslint:r:fn',
        originalSignatures: ['eslint:r:fn'],
        patchedSignatures: [],
        newSignatures: [],
        targetSeverity: over.severity ?? 'warning',
        originalSources: ['eslint'],
        patchedSources: ['eslint'],
      },
    },
  };
}

/**
 * The reported bug was "Apply works for errors, not for warnings". These pin the gate's inputs so
 * that claim is decidable rather than anecdotal: severity is passed in, and changing it must never
 * change the answer.
 */
describe('evaluateApplyGate', () => {
  const SEVERITIES = ['error', 'warning', 'info', 'hint'];

  it('enables Apply for a verified repair at every severity', () => {
    for (const severity of SEVERITIES) {
      const gate = evaluateApplyGate(proposal({ verdict: 'verified', severity }));
      expect(gate.enabled, `severity=${severity}`).toBe(true);
      expect(gate.reason).toBe('verified');
    }
  });

  it('enables Apply for unresolved and skipped verdicts at every severity', () => {
    for (const severity of SEVERITIES) {
      expect(evaluateApplyGate(proposal({ verdict: 'unresolved', severity })).enabled).toBe(true);
      expect(evaluateApplyGate(proposal({ verdict: 'skipped', severity })).enabled).toBe(true);
    }
  });

  it('disables Apply for a regression at every severity, and says why', () => {
    for (const severity of SEVERITIES) {
      const gate = evaluateApplyGate(
        proposal({ verdict: 'regression', severity, newFindingCount: 2 }),
      );
      expect(gate.enabled).toBe(false);
      expect(gate.reason).toBe('regression');
      expect(gate.explanation).toContain('2');
    }
  });

  it('distinguishes a broken-syntax regression from a new-problem regression', () => {
    expect(
      evaluateApplyGate(proposal({ verdict: 'regression', syntaxOk: false })).explanation,
    ).toContain('parse');
    expect(
      evaluateApplyGate(proposal({ verdict: 'regression', newFindingCount: 1 })).explanation,
    ).toContain('problem');
  });

  it('disables Apply for an empty patch, whatever the verdict says', () => {
    const gate = evaluateApplyGate(proposal({ verdict: 'verified', code: '' }));
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe('empty-patch');
  });

  it('produces an identical gate for an error and a warning', () => {
    // The strongest form: the whole gate value, not just `enabled`.
    expect(evaluateApplyGate(proposal({ verdict: 'verified', severity: 'warning' }))).toEqual(
      evaluateApplyGate(proposal({ verdict: 'verified', severity: 'error' })),
    );
  });

  it('always explains itself', () => {
    for (const verdict of ['verified', 'regression', 'unresolved', 'skipped'] as Verdict[]) {
      expect(evaluateApplyGate(proposal({ verdict })).explanation.length).toBeGreaterThan(0);
    }
  });
});

/** Three failure classes that looked identical from outside must now be named distinctly. */
describe('rootCauseOf', () => {
  const base: ApplyAttempt = {
    at: 0,
    findingSeverity: 'warning',
    findingId: 'f1',
    gate: evaluateApplyGate(proposal({ verdict: 'verified' })),
    request: {
      file: 'src/a.ts',
      startLine: 1,
      endLine: 3,
      code: 'x',
      expectedOriginal: 'y',
      historyId: 'h1',
    },
    response: null,
    transportError: null,
    durationMs: 5,
  };

  it('names a gate block', () => {
    const gate = evaluateApplyGate(proposal({ verdict: 'regression' }));
    expect(rootCauseOf({ ...base, gate })).toContain('Blocked before sending');
  });

  it('names a transport failure', () => {
    expect(rootCauseOf({ ...base, transportError: 'boom' })).toContain('IPC transport failed');
  });

  it('names a refusal by main, with its reason', () => {
    const cause = rootCauseOf({
      ...base,
      response: {
        applied: false,
        reason: 'stale-range',
        message: 'changed',
        staleRangeCheck: null,
      },
    });
    expect(cause).toContain('Refused by main');
    expect(cause).toContain('stale-range');
  });

  it('names success', () => {
    const cause = rootCauseOf({
      ...base,
      response: {
        applied: true,
        bytesWritten: 10,
        staleRangeCheck: {
          passed: true,
          startLine: 1,
          endLine: 3,
          fileLineCount: 10,
          expectedLength: 1,
          actualLength: 1,
          expectedHash: 'a',
          actualHash: 'a',
          firstDifferingLine: null,
          expectedExcerpt: '',
          actualExcerpt: '',
        },
      },
    });
    expect(cause).toBe('Applied successfully.');
  });
});
