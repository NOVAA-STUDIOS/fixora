import type { Finding } from '@fixora/shared-types';
import { describe, expect, it, vi } from 'vitest';

import type { AnalysisHost, VerifyJob, VerifyResult } from '../electron/main/analysis/analysis-host.js';
import { createVerificationService } from '../electron/main/verification/verification-service.js';

/**
 * Q8 — the baseline and the patched findings must come from the SAME analysis environment.
 *
 * Verification used to compare two sets sourced from different places and different moments: the
 * baseline from the database (the last time the WORKSPACE was analyzed) and the patched set from a
 * fresh single-file overlay. Measured end-to-end on the real pipeline, that gap disabled Apply on a
 * correct repair: a user who edited the file after analysis had their OWN new type error attributed
 * to the patch, because it was absent from the stale baseline.
 *
 *     with stale DB baseline    -> regression, Apply disabled  (TS2322 "introduced")
 *     with same-env baseline    -> verified,   Apply enabled
 *
 * The worker now analyzes the unpatched content in the same overlay and returns it as
 * `baselineFindings`; the service prefers it over the caller's. These pin that preference and its
 * fallback.
 */

function finding(over: { rule: string; line: number; snippet?: string }): Finding {
  return {
    id: `id-${over.rule}-${String(over.line)}`,
    source: 'tsc',
    ruleId: over.rule,
    severity: 'error',
    category: 'correctness',
    location: { file: 'a.ts', startLine: over.line, startCol: 1, endLine: over.line, endCol: 2 },
    message: `${over.rule} message`,
    evidence: { snippet: over.snippet ?? `code-${over.rule}`, relatedLocations: [], toolOutput: {} },
    fixable: true,
    repair: 'ai-required',
    confidence: 1,
  };
}

/** A host whose verify returns exactly the result given, so the service's choice is what is tested. */
function hostReturning(result: VerifyResult): AnalysisHost & { lastJob: () => VerifyJob | null } {
  let lastJob: VerifyJob | null = null;
  return {
    lastJob: () => lastJob,
    run: vi.fn(),
    verify: (job: VerifyJob) => {
      lastJob = job;
      job.onResult(result);
    },
    resolveScope: vi.fn(),
    microRepair: vi.fn(),
    cancel: vi.fn(),
    dispose: vi.fn(),
  } as unknown as AnalysisHost & { lastJob: () => VerifyJob | null };
}

const TARGET = finding({ rule: 'TS2339', line: 32 });
/** The problem the USER introduced after the last analysis — absent from the database baseline. */
const USER_EDIT = finding({ rule: 'TS2322', line: 45 });

const INPUT = {
  finding: TARGET,
  repairedCode: 'const fixed = await response.json();',
  target: { file: 'a.ts', startLine: 26, endLine: 34, language: 'typescript' as const },
  workspaceRoot: 'C:/nonexistent-workspace-for-test',
  originalContent: 'line1\nline2\nline3\n',
};

describe('verification baseline — same environment, not the database', () => {
  it("uses the worker's baseline, so a user's own post-analysis edit is not blamed on the patch", async () => {
    const host = hostReturning({
      syntaxOk: true,
      // The patched overlay still has the user's error — the patch did not touch it.
      findings: [USER_EDIT],
      // The worker's baseline, from the SAME content: it has that error too.
      baselineFindings: [TARGET, USER_EDIT],
      aborted: false,
    });
    const service = createVerificationService({ host });

    const { report } = await service.verify({
      ...INPUT,
      // The database is stale: it never saw the user's edit.
      originalFindings: [TARGET],
    });

    expect(report.verdict).toBe('verified');
    expect(report.newFindingCount).toBe(0);
  });

  it('without the worker baseline, the same inputs regress — the defect this fixes', async () => {
    const host = hostReturning({
      syntaxOk: true,
      findings: [USER_EDIT],
      // No baselineFindings: the old behaviour, falling back to the stale caller baseline.
      aborted: false,
    });
    const service = createVerificationService({ host });

    const { report } = await service.verify({ ...INPUT, originalFindings: [TARGET] });

    expect(report.verdict).toBe('regression');
    expect(report.newFindings?.[0]?.ruleId).toBe('TS2322');
  });

  it('still reports a genuine regression when the worker baseline is used', async () => {
    const host = hostReturning({
      syntaxOk: true,
      // The patch really did introduce something the baseline does not have.
      findings: [finding({ rule: 'TS2554', line: 30, snippet: 'brand-new' })],
      baselineFindings: [TARGET],
      aborted: false,
    });
    const service = createVerificationService({ host });

    const { report } = await service.verify({ ...INPUT, originalFindings: [TARGET] });

    expect(report.verdict).toBe('regression');
    expect(report.newFindings?.[0]?.ruleId).toBe('TS2554');
  });

  it('passes the pre-patch bytes to the worker, which is what lets it compute a baseline at all', async () => {
    const host = hostReturning({ syntaxOk: true, findings: [], baselineFindings: [], aborted: false });
    const service = createVerificationService({ host });
    await service.verify({ ...INPUT, originalFindings: [] });
    expect(host.lastJob()?.originalSource).toBe(INPUT.originalContent);
  });

  it('carries the correlation id through to the worker job', async () => {
    const host = hostReturning({ syntaxOk: true, findings: [], baselineFindings: [], aborted: false });
    const service = createVerificationService({ host });
    const { verifyId } = await service.verify({
      ...INPUT,
      originalFindings: [],
      verifyId: 'trace-me',
    });
    expect(verifyId).toBe('trace-me');
    expect(host.lastJob()?.id).toBe('trace-me');
  });
});
