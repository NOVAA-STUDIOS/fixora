import { describe, expect, it } from 'vitest';

import { renderReport } from './report.js';
import type {
  AttemptRecord,
  FinalOutcome,
  ProjectResult,
  RunResult,
  StageResult,
} from './types.js';

/**
 * The report is the harness's only claim to trust: if its arithmetic lies, every number downstream
 * lies. These tests pin that a rate never flatters an empty denominator, that a regressed or
 * verification-failed attempt is NOT counted as applied, and that every failure surfaces its exact
 * subsystem and reason. The math is the product here — it is tested like product.
 */

const ran = (ok: boolean): StageResult => ({ ran: true, ok, detail: ok ? 'ok' : 'failed' });
const notRun: StageResult = { ran: false, ok: false, detail: 'not reached' };

function attempt(over: Partial<AttemptRecord>): AttemptRecord {
  return {
    language: 'python',
    project: 'p',
    file: 'a.py',
    ruleId: 'X',
    source: 'ruff',
    severity: 'warning',
    repairability: 'safe-auto',
    stage: 'compile',
    subsystem: 'none',
    rootCause: 'ok',
    runtimeMs: 10,
    repair: ran(true),
    verification: ran(true),
    apply: ran(true),
    reanalysis: ran(true),
    compile: ran(true),
    finalOutcome: 'SAFE_AUTO_REPAIR_APPLIED',
    ...over,
  };
}

function project(over: Partial<ProjectResult>): ProjectResult {
  return {
    project: 'p',
    language: 'python',
    root: '/p',
    filesAnalyzed: 1,
    findings: 0,
    analyzeMs: 100,
    baselineCompile: ran(true),
    attempts: [],
    ...over,
  };
}

function run(projects: ProjectResult[]): RunResult {
  return { ranAt: '2026-07-23T00:00:00Z', providerKeyPresent: false, projects };
}

describe('renderReport — measurement integrity', () => {
  it('counts a regression as an attempt but NOT as an applied repair', () => {
    const md = renderReport(
      run([
        project({
          attempts: [
            attempt({ finalOutcome: 'SAFE_AUTO_REPAIR_APPLIED' }),
            attempt({
              finalOutcome: 'REGRESSION_DETECTED',
              subsystem: 'regression-verifier',
              stage: 'regression',
              rootCause: 'introduced eslint:no-undef',
              apply: { ran: false, ok: false, detail: 'blocked: regression detected' },
            }),
          ],
        }),
      ]),
    );
    // 2 deterministic attempts, only 1 applied → 50%.
    expect(md).toContain('Deterministic repairs applied (survived full loop) | 1 / 2 (50.0%)');
    // The regression is listed with its exact subsystem + reason, and is not silently dropped.
    expect(md).toContain(
      '`REGRESSION_DETECTED` at stage `regression` (subsystem: `regression-verifier`)',
    );
    expect(md).toContain('introduced eslint:no-undef');
  });

  it('shows n/a for an empty denominator rather than a flattering 100%', () => {
    const md = renderReport(
      run([
        project({
          attempts: [
            attempt({
              repairability: 'ai-required',
              finalOutcome: 'AI_DEFERRED',
              repair: notRun,
              verification: notRun,
              apply: notRun,
              reanalysis: notRun,
              compile: notRun,
            }),
          ],
        }),
      ]),
    );
    // No deterministic attempts ran, so applied/verify/apply/compile rates are n/a, never 100%.
    expect(md).toContain('Deterministic repairs applied (survived full loop) | n/a');
    expect(md).toContain('Verification pass rate (of those that ran) | n/a');
    expect(md).not.toContain('100.0%');
  });

  it('a verification-failed attempt does not inflate the apply or compile rates', () => {
    const md = renderReport(
      run([
        project({
          attempts: [
            attempt({
              finalOutcome: 'VERIFICATION_FAILED',
              stage: 'verify-parse',
              subsystem: 'ast-verifier',
              rootCause: 'patched file does not parse',
              verification: ran(false),
              apply: notRun,
              reanalysis: notRun,
              compile: notRun,
            }),
          ],
        }),
      ]),
    );
    // verification ran and failed → 0/1; apply/compile never ran → n/a (not counted as pass).
    expect(md).toContain('Verification pass rate (of those that ran) | 0 / 1 (0.0%)');
    expect(md).toContain('Apply success rate (of those that ran) | n/a');
    expect(md).toContain('Compile pass rate (of those that ran) | n/a');
  });

  it('groups per-language by project, so every declared language appears (incl. zero-finding CSS/HTML)', () => {
    const md = renderReport(
      run([
        project({ project: 'css1', language: 'css', attempts: [] }),
        project({ project: 'py1', language: 'python', attempts: [attempt({})] }),
      ]),
    );
    expect(md).toMatch(/\| css \| 1 \| 0 \|/);
    expect(md).toMatch(/\| python \| 1 \| 1 \|/);
  });

  it('reports project errors honestly and never as a pass', () => {
    const md = renderReport(run([project({ error: 'skipped: requires ruff (not available)' })]));
    expect(md).toContain('Projects skipped/errored | 1');
    expect(md).toContain('skipped: requires ruff (not available)');
  });

  const outcomes: FinalOutcome[] = [
    'SAFE_AUTO_REPAIR_APPLIED',
    'AI_DEFERRED',
    'MANUAL_FIX_REQUIRED',
  ];
  it('every finding lands in exactly one outcome bucket, and the buckets sum to the total', () => {
    const md = renderReport(
      run([
        project({
          attempts: outcomes.map((o) =>
            attempt({
              finalOutcome: o,
              repairability:
                o === 'SAFE_AUTO_REPAIR_APPLIED'
                  ? 'safe-auto'
                  : o === 'AI_DEFERRED'
                    ? 'ai-required'
                    : 'manual',
            }),
          ),
        }),
      ]),
    );
    expect(md).toContain('Total findings | 3');
    for (const o of outcomes) expect(md).toContain(`| ${o} | 1 |`);
  });
});
