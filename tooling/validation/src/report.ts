import type { AttemptRecord, FinalOutcome, RunResult } from './types.js';

/**
 * Render a measured validation report. Every number is counted from the records — nothing is derived
 * by assumption. Rates are shown as "n / d" so the denominator is always visible; a rate over an empty
 * denominator is `n/a`, never a flattering 100%.
 */

const OUTCOMES: FinalOutcome[] = [
  'SAFE_AUTO_REPAIR_APPLIED',
  'MANUAL_FIX_REQUIRED',
  'AI_DEFERRED',
  'UNSUPPORTED_LANGUAGE',
  'UNSUPPORTED_RULE',
  'VERIFICATION_FAILED',
  'REGRESSION_DETECTED',
  'APPLY_FAILED',
];

function frac(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${String(n)} / ${String(d)} (${((n / d) * 100).toFixed(1)}%)`;
}

function row(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

const allAttempts = (run: RunResult): AttemptRecord[] => run.projects.flatMap((p) => p.attempts);

/** The deterministic repairs that were actually executed (the only leg measurable without a key). */
const deterministic = (a: AttemptRecord[]): AttemptRecord[] =>
  a.filter((r) => r.repairability === 'safe-auto');

export function renderReport(run: RunResult): string {
  const attempts = allAttempts(run);
  const det = deterministic(attempts);
  const applied = det.filter((r) => r.finalOutcome === 'SAFE_AUTO_REPAIR_APPLIED');
  const verifyRan = det.filter((r) => r.verification.ran);
  const verifyOk = verifyRan.filter((r) => r.verification.ok);
  const applyRan = det.filter((r) => r.apply.ran);
  const applyOk = applyRan.filter((r) => r.apply.ok);
  const compileRan = det.filter((r) => r.compile.ran);
  const compileOk = compileRan.filter((r) => r.compile.ok);
  const regressions = det.filter((r) => r.finalOutcome === 'REGRESSION_DETECTED');

  const avg = (nums: number[]): string =>
    nums.length === 0
      ? 'n/a'
      : `${String(Math.round(nums.reduce((s, n) => s + n, 0) / nums.length))} ms`;

  const lines: string[] = [
    '# Fixora — Real Repository Validation Report (P1.1)',
    '',
    `Generated ${run.ranAt} from a REAL execution of the engine over the validation corpus.`,
    `Provider key present: **${run.providerKeyPresent ? 'yes' : 'no'}** — ${
      run.providerKeyPresent
        ? 'AI-required repairs were executed.'
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
    row(['Deterministic repair attempts', String(det.length)]),
    row(['Deterministic repairs applied (survived full loop)', frac(applied.length, det.length)]),
    row(['Verification pass rate (of those that ran)', frac(verifyOk.length, verifyRan.length)]),
    row(['Apply success rate (of those that ran)', frac(applyOk.length, applyRan.length)]),
    row(['Compile pass rate (of those that ran)', frac(compileOk.length, compileRan.length)]),
    row(['Regressions rejected by the harness', String(regressions.length)]),
    row([
      'Manual-only findings',
      String(attempts.filter((r) => r.finalOutcome === 'MANUAL_FIX_REQUIRED').length),
    ]),
    row([
      'AI-deferred findings (need a key)',
      String(attempts.filter((r) => r.finalOutcome === 'AI_DEFERRED').length),
    ]),
    row([
      'Unsupported-language findings',
      String(attempts.filter((r) => r.finalOutcome === 'UNSUPPORTED_LANGUAGE').length),
    ]),
    row(['Avg deterministic repair→compile time', avg(det.map((r) => r.runtimeMs))]),
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

  // Grouped by each project's declared (target) language, so all seven show — including CSS/HTML/JSON
  // that legitimately produce zero repairable findings. Bucketing by the tree language would instead
  // collapse React (.tsx) into TypeScript, which is not what "validate React" means here.
  lines.push(
    '',
    '## Per language',
    '',
    row([
      'Language',
      'Projects',
      'Findings',
      'Det.applied',
      'Manual',
      'AI-deferred',
      'Regressions',
    ]),
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
    const d = deterministic(g.attempts);
    lines.push(
      row([
        lang,
        String(g.projects),
        String(g.attempts.length),
        frac(d.filter((r) => r.finalOutcome === 'SAFE_AUTO_REPAIR_APPLIED').length, d.length),
        String(g.attempts.filter((r) => r.finalOutcome === 'MANUAL_FIX_REQUIRED').length),
        String(g.attempts.filter((r) => r.finalOutcome === 'AI_DEFERRED').length),
        String(g.attempts.filter((r) => r.finalOutcome === 'REGRESSION_DETECTED').length),
      ]),
    );
  }

  // Every non-success deterministic attempt, with the exact subsystem + reason (reproducible).
  const failures = det.filter((r) => r.finalOutcome !== 'SAFE_AUTO_REPAIR_APPLIED');
  lines.push('', '## Deterministic repair failures (exact subsystem + reason)', '');
  if (failures.length === 0)
    lines.push('_None — every executed deterministic repair survived the full loop._', '');
  else {
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
