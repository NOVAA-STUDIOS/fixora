import type { AttemptRecord, FinalOutcome, RunResult } from './types.js';

/**
 * Render a measured validation report. Every number is counted from the records — nothing is derived
 * by assumption. Rates are shown as "n / d" so the denominator is always visible; a rate over an empty
 * denominator is `n/a`, never a flattering 100%.
 */

const OUTCOMES: FinalOutcome[] = [
  'SAFE_AUTO_REPAIR_APPLIED',
  'AI_REPAIR_APPLIED',
  'AI_GENERATE_FAILED',
  'MANUAL_FIX_REQUIRED',
  'AI_DEFERRED',
  'UNSUPPORTED_LANGUAGE',
  'UNSUPPORTED_RULE',
  'VERIFICATION_FAILED',
  'REGRESSION_DETECTED',
  'APPLY_FAILED',
];

/** The exact-subsystem → sprint-classification map (requirement 4's 11-way taxonomy). */
const TAXONOMY: Record<string, string> = {
  analyzer: 'Analyzer issue',
  'eligibility-engine': 'Unsupported/manual',
  'scope-selector': 'Context extraction issue',
  'context-builder': 'Context extraction issue',
  'prompt-builder': 'Prompt generation issue',
  'ai-provider': 'Provider limitation',
  'response-parser': 'Model output issue',
  'patch-extractor': 'Model output issue',
  'ast-verifier': 'Parser issue',
  formatter: 'Formatter issue',
  'regression-verifier': 'Verifier / regression detection',
  'apply-engine': 'Apply issue',
  'compile-runner': 'Verifier / regression detection',
  none: 'None (survived)',
};

function frac(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${String(n)} / ${String(d)} (${((n / d) * 100).toFixed(1)}%)`;
}

function row(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

const allAttempts = (run: RunResult): AttemptRecord[] => run.projects.flatMap((p) => p.attempts);

const APPLIED_OUTCOMES: FinalOutcome[] = ['SAFE_AUTO_REPAIR_APPLIED', 'AI_REPAIR_APPLIED'];

/**
 * A repair was ATTEMPTED (a patch was generated and gates were run, or generation itself failed) —
 * as opposed to deferred/manual/unsupported, where no repair was tried. This is the honest denominator
 * for success/failure/regression rates: only attempts where the engine actually tried to fix something.
 */
const ATTEMPTED_OUTCOMES: FinalOutcome[] = [
  'SAFE_AUTO_REPAIR_APPLIED',
  'AI_REPAIR_APPLIED',
  'AI_GENERATE_FAILED',
  'VERIFICATION_FAILED',
  'REGRESSION_DETECTED',
  'APPLY_FAILED',
];

const isAttempted = (r: AttemptRecord): boolean => ATTEMPTED_OUTCOMES.includes(r.finalOutcome);
const isApplied = (r: AttemptRecord): boolean => APPLIED_OUTCOMES.includes(r.finalOutcome);

export function renderReport(run: RunResult): string {
  const attempts = allAttempts(run);
  const attempted = attempts.filter(isAttempted);
  const applied = attempted.filter(isApplied);
  const det = attempted.filter((r) => r.repairability === 'safe-auto');
  const aiExecuted = attempted.filter((r) => r.repairability === 'ai-required');
  const verifyRan = attempted.filter((r) => r.verification.ran);
  const verifyOk = verifyRan.filter((r) => r.verification.ok);
  const applyRan = attempted.filter((r) => r.apply.ran);
  const applyOk = applyRan.filter((r) => r.apply.ok);
  const compileRan = attempted.filter((r) => r.compile.ran);
  const compileOk = compileRan.filter((r) => r.compile.ok);
  const regressions = attempted.filter((r) => r.finalOutcome === 'REGRESSION_DETECTED');

  const avg = (nums: number[]): string =>
    nums.length === 0
      ? 'n/a'
      : `${String(Math.round(nums.reduce((s, n) => s + n, 0) / nums.length))} ms`;

  const lines: string[] = [
    '# Fixora — Real Repository Repair Acceptance Report (P1.2)',
    '',
    `Generated ${run.ranAt} from a REAL execution of the engine over the acceptance corpus.`,
    `Provider key present: **${run.providerKeyPresent ? 'yes' : 'no'}** — ${
      run.providerKeyPresent
        ? 'AI-required repairs were GENERATED and run through the same gates as deterministic ones.'
        : 'AI-required repairs are DEFERRED (not measurable without a key) and never counted as success.'
    }`,
    '',
    '## Summary (measured)',
    '',
    row(['Metric', 'Value']),
    row(['---', '---:']),
    row(['Projects validated', String(run.projects.filter((p) => p.error === undefined).length)]),
    row([
      'Projects skipped/errored',
      String(run.projects.filter((p) => p.error !== undefined).length),
    ]),
    row(['Total findings', String(attempts.length)]),
    row(['Total repair ATTEMPTS (deterministic + AI executed)', String(attempted.length)]),
    row(['— of which deterministic', String(det.length)]),
    row(['— of which AI (executed, needs key)', String(aiExecuted.length)]),
    row([
      '**Repair success rate** (applied, survived full loop)',
      frac(applied.length, attempted.length),
    ]),
    row(['**Repair failure rate**', frac(attempted.length - applied.length, attempted.length)]),
    row(['**Regression rate**', frac(regressions.length, attempted.length)]),
    row(['Verification pass rate (of those that ran)', frac(verifyOk.length, verifyRan.length)]),
    row(['Apply success rate (of those that ran)', frac(applyOk.length, applyRan.length)]),
    row(['Compile pass rate (of those that ran)', frac(compileOk.length, compileRan.length)]),
    row([
      'AI-deferred (need a key)',
      String(attempts.filter((r) => r.finalOutcome === 'AI_DEFERRED').length),
    ]),
    row([
      'Manual-only findings',
      String(attempts.filter((r) => r.finalOutcome === 'MANUAL_FIX_REQUIRED').length),
    ]),
    row(['Avg repair→compile time (attempted)', avg(attempted.map((r) => r.runtimeMs))]),
    row([
      'Avg project analyze time',
      avg(run.projects.filter((p) => p.error === undefined).map((p) => p.analyzeMs)),
    ]),
    '',
    '## Final outcomes (every finding lands in exactly one)',
    '',
    row(['Outcome', 'Count']),
    row(['---', '---:']),
  ];
  for (const o of OUTCOMES) {
    const n = attempts.filter((r) => r.finalOutcome === o).length;
    if (n > 0) lines.push(row([o, String(n)]));
  }

  /**
   * Retry effectiveness — how many attempts each repair actually needed.
   *
   * The headline success rate hides this entirely: a repair that verified first try and one that
   * needed all three re-asks both land in the same bucket, so "is the retry loop earning its tokens?"
   * was unanswerable from this report. Counted only from records that carry `verifyAttempts`; every
   * record without it is reported as not-measured rather than silently counted as one attempt.
   */
  const withAttempts = attempts.filter(
    (r) => r.verifyAttempts !== undefined && r.verifyAttempts.length > 0,
  );
  lines.push('', '## Retry effectiveness', '');
  if (withAttempts.length === 0) {
    lines.push(
      `_Not measured by this run: 0 of ${String(attempts.length)} records carry per-attempt data._`,
      '',
      'This harness drives `generate.ts` directly rather than `ai-service.ts`, whose verify/re-ask',
      'loop is what produces `verifyAttempts`. Wire the harness through that loop to populate it.',
    );
  } else {
    const buckets = new Map<number, number>();
    let resolvedOnRetry = 0;
    for (const r of withAttempts) {
      const list = r.verifyAttempts ?? [];
      const n = list.length;
      buckets.set(n, (buckets.get(n) ?? 0) + 1);
      const final = list[list.length - 1];
      if (n > 1 && final?.verdict === 'verified') resolvedOnRetry += 1;
    }
    lines.push(row(['Attempts needed', 'Findings']), row(['---', '---:']));
    for (const n of [...buckets.keys()].sort((a, b) => a - b)) {
      lines.push(row([String(n), String(buckets.get(n) ?? 0)]));
    }
    lines.push(
      '',
      row(['Metric', 'Value']),
      row(['---', '---:']),
      row(['Records with per-attempt data', frac(withAttempts.length, attempts.length)]),
      row(['Verified on attempt 1', frac(buckets.get(1) ?? 0, withAttempts.length)]),
      // The number the retry loop exists to produce: repairs that FAILED first and passed later.
      row(['Rescued by a retry (failed first, verified later)', frac(resolvedOnRetry, withAttempts.length)]),
    );
  }

  // Grouped by each project's declared (target) language, so all seven show — including CSS/HTML/JSON
  // that legitimately produce zero repairable findings. Bucketing by the tree language would instead
  // collapse React (.tsx) into TypeScript, which is not what "validate React" means here.
  lines.push(
    '',
    '## Per language',
    '',
    row(['Language', 'Projects', 'Findings', 'Applied', 'Manual', 'AI-deferred', 'Regressions']),
    row(['---', '---:', '---:', '---:', '---:', '---:', '---:']),
  );
  const byLang = new Map<string, { projects: number; attempts: AttemptRecord[] }>();
  for (const p of run.projects) {
    const g = byLang.get(p.language) ?? { projects: 0, attempts: [] };
    g.projects += 1;
    g.attempts.push(...p.attempts);
    byLang.set(p.language, g);
  }
  for (const [lang, g] of [...byLang.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const tried = g.attempts.filter(isAttempted);
    lines.push(
      row([
        lang,
        String(g.projects),
        String(g.attempts.length),
        frac(tried.filter(isApplied).length, tried.length),
        String(g.attempts.filter((r) => r.finalOutcome === 'MANUAL_FIX_REQUIRED').length),
        String(g.attempts.filter((r) => r.finalOutcome === 'AI_DEFERRED').length),
        String(g.attempts.filter((r) => r.finalOutcome === 'REGRESSION_DETECTED').length),
      ]),
    );
  }

  // Failure taxonomy: every non-applied ATTEMPT bucketed by the exact subsystem responsible, mapped to
  // the sprint's required classification. This is the "top recurring failure causes" evidence.
  const failures = attempted.filter((r) => !isApplied(r));
  lines.push('', '## Failure taxonomy (exact subsystem responsible)', '');
  if (failures.length === 0)
    lines.push('_None — every executed repair (deterministic + AI) survived the full loop._', '');
  else {
    const bySubsystem = new Map<string, AttemptRecord[]>();
    for (const f of failures) {
      const list = bySubsystem.get(f.subsystem) ?? [];
      list.push(f);
      bySubsystem.set(f.subsystem, list);
    }
    lines.push(row(['Subsystem', 'Classification', 'Count']), row(['---', '---', '---:']));
    for (const [sub, list] of [...bySubsystem.entries()].sort(
      (a, b) => b[1].length - a[1].length,
    )) {
      lines.push(row([`\`${sub}\``, TAXONOMY[sub] ?? 'Unclassified', String(list.length)]));
    }
    lines.push('', '### Every failure (reproducible: file + rule + stage + root cause)', '');
    for (const f of failures) {
      lines.push(
        `- **${f.project}/${f.file}** ${f.source}:${f.ruleId} → \`${f.finalOutcome}\` at stage \`${f.stage}\` (subsystem: \`${f.subsystem}\`) — ${f.rootCause}`,
      );
    }
    lines.push('');
  }

  lines.push('## Project errors / skips (honest)', '');
  const errored = run.projects.filter((p) => p.error !== undefined);
  if (errored.length === 0) lines.push('_None._', '');
  else {
    for (const p of errored) lines.push(`- **${p.project}** (${p.language}): ${p.error ?? ''}`);
    lines.push('');
  }

  lines.push(
    '## Not measured here (explicit)',
    '',
    '- **AI-generated repairs**: require a provider key; deferred, never faked. Counted separately above.',
    '- **CSS / HTML**: no analyzer, so no findings and nothing to repair — reported as unsupported.',
    '',
  );
  return lines.join('\n');
}
