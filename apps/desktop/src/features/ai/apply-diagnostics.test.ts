import type { AiProposal, Verdict } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import {
  evaluateApplyGate,
  remedyFor,
  rootCauseOf,
  type ApplyAttempt,
} from './apply-diagnostics.js';

type Repair = Extract<AiProposal, { profile: 'repair' }>;

function proposal(over: {
  verdict: Verdict;
  severity?: string;
  code?: string;
  newFindingCount?: number;
  syntaxOk?: boolean;
  syntaxError?: { line: number; column: number; text: string };
  formatter?: { ran: boolean; ok: boolean; formatter?: string; message?: string };
  newFindings?: { source: string; ruleId: string; line: number; message: string }[];
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
      ...(over.syntaxError !== undefined ? { syntaxError: over.syntaxError } : {}),
      ...(over.formatter !== undefined ? { formatter: over.formatter } : {}),
      ...(over.newFindings !== undefined ? { newFindings: over.newFindings } : {}),
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

  it('disables Apply for a regression at every severity, via the verifier gate, and says why', () => {
    for (const severity of SEVERITIES) {
      const gate = evaluateApplyGate(
        proposal({ verdict: 'regression', severity, newFindingCount: 2 }),
      );
      expect(gate.enabled).toBe(false);
      expect(gate.reason).toBe('verifier');
      expect(gate.explanation).toContain('2');
    }
  });

  it('routes a broken-syntax regression to the PARSER gate and a new-problem one to the VERIFIER gate', () => {
    const parserGate = evaluateApplyGate(proposal({ verdict: 'regression', syntaxOk: false }));
    expect(parserGate.enabled).toBe(false);
    expect(parserGate.reason).toBe('parser');
    expect(parserGate.explanation.toLowerCase()).toContain('parse');

    const verifierGate = evaluateApplyGate(proposal({ verdict: 'regression', newFindingCount: 1 }));
    expect(verifierGate.reason).toBe('verifier');
    expect(verifierGate.explanation).toContain('problem');
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

/**
 * The three quality gates (Goals 4 & 9), evaluated Parser -> Verifier -> Formatter. Each case pins
 * that the EXACT failing gate is named, never a generic message, and that a fully-clean patch enables
 * Apply. This is the wiring the sprint delivers.
 */
describe('quality gates — parser -> verifier -> formatter', () => {
  it('VALID patch: all gates pass -> Apply enabled', () => {
    const gate = evaluateApplyGate(
      proposal({ verdict: 'verified', formatter: { ran: true, ok: true, formatter: 'prettier' } }),
    );
    expect(gate.enabled).toBe(true);
    expect(gate.gates.map((g) => g.status)).toEqual(['pass', 'pass', 'pass']);
  });

  it('PARSER failure -> Apply disabled, names the gate and the line', () => {
    const gate = evaluateApplyGate(
      proposal({
        verdict: 'regression',
        syntaxOk: false,
        syntaxError: { line: 7, column: 3, text: "Missing ')'" },
      }),
    );
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe('parser');
    expect(gate.explanation).toContain('line 7');
    expect(gate.explanation).not.toMatch(/something went wrong|internal error/i);
    // Downstream gates must not run once the file does not parse.
    expect(gate.gates.find((g) => g.name === 'verifier')?.status).toBe('not-run');
  });

  it('VERIFIER failure -> Apply disabled, lists the new finding with its line', () => {
    const gate = evaluateApplyGate(
      proposal({
        verdict: 'regression',
        newFindingCount: 1,
        newFindings: [
          { source: 'eslint', ruleId: 'no-undef', line: 12, message: "'x' is not defined" },
        ],
      }),
    );
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe('verifier');
    expect(gate.explanation).toContain('no-undef');
    expect(gate.explanation).toContain('line 12');
  });

  it('COMPILER failure (tsc) -> Apply disabled, headline says TypeScript diagnostics', () => {
    const gate = evaluateApplyGate(
      proposal({
        verdict: 'regression',
        newFindingCount: 1,
        newFindings: [
          { source: 'tsc', ruleId: 'TS2345', line: 4, message: "Argument of type 'string'..." },
        ],
      }),
    );
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe('verifier');
    expect(gate.explanation).toContain('TypeScript diagnostics');
    expect(gate.explanation).toContain('TS2345');
  });

  it('FORMATTER failure -> Apply disabled, names the formatter gate with its message', () => {
    const gate = evaluateApplyGate(
      proposal({
        verdict: 'verified',
        formatter: {
          ran: true,
          ok: false,
          formatter: 'prettier',
          message: 'a.ts: SyntaxError line 3',
        },
      }),
    );
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe('formatter');
    expect(gate.explanation).toContain('Formatter failed');
    if (!gate.enabled) expect(gate.diagnostic).toContain('line 3');
  });

  it('a not-run formatter (none installed) does NOT block a verified patch', () => {
    const gate = evaluateApplyGate(proposal({ verdict: 'verified' })); // no formatter field
    expect(gate.enabled).toBe(true);
    expect(gate.gates.find((g) => g.name === 'formatter')?.status).toBe('not-run');
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

/**
 * Every failure must offer a way forward.
 *
 * The panel renders `remedy.label` as a button and `remedy.reason` as the headline, so a missing
 * or empty remedy is a dead end on screen: a user told what went wrong and given nothing to do.
 * These assert coverage across every failure the system can produce, and that the language stays
 * out of the codebase's own vocabulary.
 */
describe('remedyFor', () => {
  const enabledGate = evaluateApplyGate(proposal({ verdict: 'verified' }));
  const attempt = (over: Partial<ApplyAttempt>): ApplyAttempt => ({
    at: 0,
    findingSeverity: 'warning',
    findingId: 'f1',
    gate: enabledGate,
    request: {
      file: 'a.ts',
      startLine: 1,
      endLine: 2,
      code: 'x',
      expectedOriginal: 'y',
      historyId: 'h',
    },
    response: null,
    transportError: null,
    durationMs: 1,
    ...over,
  });

  it('offers a remedy for every main-process refusal', () => {
    const reasons = ['stale-range', 'range-out-of-bounds', 'no-workspace', 'write-failed'] as const;
    for (const reason of reasons) {
      const r = remedyFor(
        attempt({ response: { applied: false, reason, message: 'm', staleRangeCheck: null } }),
        enabledGate,
      );
      expect(r, reason).not.toBeNull();
      expect(r?.label.length, reason).toBeGreaterThan(0);
      expect(r?.reason.length, reason).toBeGreaterThan(0);
      expect(r?.detail.length, reason).toBeGreaterThan(0);
    }
  });

  it('offers a remedy for every gate refusal', () => {
    for (const p of [
      proposal({ verdict: 'regression', newFindingCount: 1 }),
      proposal({ verdict: 'verified', code: '' }),
    ]) {
      const gate = evaluateApplyGate(p);
      const r = remedyFor(null, gate);
      expect(r).not.toBeNull();
      expect(r?.label.length).toBeGreaterThan(0);
    }
    expect(remedyFor(null, evaluateApplyGate(null))).not.toBeNull();
  });

  it('offers a remedy when the IPC itself fails', () => {
    const r = remedyFor(attempt({ transportError: 'EPIPE' }), enabledGate);
    expect(r?.kind).toBe('retry-repair');
    expect(r?.detail).toContain('EPIPE');
  });

  it('sends a stale range to "run repair again", not to a dead end', () => {
    const r = remedyFor(
      attempt({
        response: { applied: false, reason: 'stale-range', message: 'm', staleRangeCheck: null },
      }),
      enabledGate,
    );
    expect(r?.kind).toBe('retry-repair');
    expect(r?.reason).toBe('The file has changed since this repair was generated.');
  });

  it('offers nothing when the apply succeeded — no banner on a success', () => {
    const r = remedyFor(
      attempt({
        response: {
          applied: true,
          bytesWritten: 10,
          staleRangeCheck: {
            passed: true,
            startLine: 1,
            endLine: 2,
            fileLineCount: 5,
            expectedLength: 1,
            actualLength: 1,
            expectedHash: 'a',
            actualHash: 'a',
            firstDifferingLine: null,
            expectedExcerpt: '',
            actualExcerpt: '',
          },
        },
      }),
      enabledGate,
    );
    expect(r).toBeNull();
    expect(remedyFor(null, enabledGate)).toBeNull();
  });

  it('speaks plain English — no internal identifiers in user-facing copy', () => {
    // "stale-range" is a code. If it reaches the headline, the tiering has failed.
    const jargon = ['stale-range', 'range-out-of-bounds', 'IPC', 'sha1', 'verdict', 'signature'];
    const r = remedyFor(
      attempt({
        response: { applied: false, reason: 'stale-range', message: 'm', staleRangeCheck: null },
      }),
      enabledGate,
    );
    for (const term of jargon) {
      expect(r?.reason.toLowerCase(), term).not.toContain(term.toLowerCase());
    }
  });
});
