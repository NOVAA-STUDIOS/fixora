import {
  addCounts,
  computeMetrics,
  emptyCounts,
  formatRate,
  type Counts,
  type Metrics,
} from './metrics.js';
import type { CaseResult, SuiteResult } from './run.js';

/**
 * The Accuracy Dashboard and the Accuracy Report.
 *
 * One rule shapes every line of this file: **a number that was not measured is never printed as a
 * number.** Unmeasured is `n/a` with a stated reason. That applies to unsupported languages, to
 * skipped cases, and to every repair metric until a provider key exists.
 */

export type Group = { name: string; counts: Counts; metrics: Metrics; cases: number };

/** Repair metrics, which cannot be produced without a provider. Shape is final; values are not. */
export type RepairMeasurement =
  | { measured: false; reason: string }
  | {
      measured: true;
      attempted: number;
      verified: number;
      applied: number;
      regressions: number;
    };

export type Dashboard = {
  ranAt: string;
  capabilities: SuiteResult['capabilities'];
  overall: { counts: Counts; metrics: Metrics };
  byLanguage: Group[];
  byAnalyzer: Group[];
  byRule: Group[];
  unsupported: { language: string; cases: number; reason: string }[];
  skipped: { id: string; reason: string }[];
  benchmarks: {
    passed: number;
    failed: number;
    knownDefects: number;
    skipped: number;
    unsupported: number;
    total: number;
  };
  /** Defects Fixora is known to have, each exposed by a case that deliberately still fails. */
  knownDefects: { id: string; language: string; reason: string; owner: string | undefined }[];
  repair: RepairMeasurement;
};

/** Only supported, actually-executed cases contribute to accuracy. See metrics.ts, rule 2. */
const scored = (cases: readonly CaseResult[]): CaseResult[] =>
  cases.filter((c) => c.status === 'pass' || c.status === 'fail' || c.status === 'known-defect');

function group(cases: readonly CaseResult[], keyOf: (c: CaseResult) => string[]): Group[] {
  const map = new Map<string, { counts: Counts; cases: number }>();
  for (const c of cases) {
    for (const key of keyOf(c)) {
      const entry = map.get(key) ?? { counts: emptyCounts(), cases: 0 };
      entry.counts = addCounts(entry.counts, c.counts);
      entry.cases += 1;
      map.set(key, entry);
    }
  }
  return [...map.entries()]
    .map(([name, v]) => ({
      name,
      counts: v.counts,
      metrics: computeMetrics(v.counts),
      cases: v.cases,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Per-analyzer and per-rule grouping keys.
 *
 * Taken from the *expectations and the actuals together*, not from one side: an analyzer that
 * produced a false positive must appear in its own row even when no case expected anything from it,
 * and an analyzer that missed everything must appear even though it produced nothing.
 */
function analyzersIn(c: CaseResult): string[] {
  const set = new Set<string>();
  for (const o of c.outcomes) {
    if (o.kind === 'false-positive') set.add(o.actual.source);
    else if (o.kind !== 'ignored') set.add(o.expected.analyzer);
  }
  return [...set];
}

function rulesIn(c: CaseResult): string[] {
  const set = new Set<string>();
  for (const o of c.outcomes) {
    if (o.kind === 'false-positive') set.add(o.actual.ruleId);
    else if (o.kind !== 'ignored') set.add(o.expected.ruleId);
  }
  return [...set];
}

export function buildDashboard(suite: SuiteResult, repair: RepairMeasurement): Dashboard {
  const measured = scored(suite.cases);
  const overallCounts = measured.reduce((acc, c) => addCounts(acc, c.counts), emptyCounts());

  const unsupportedByLanguage = new Map<string, { cases: number; reason: string }>();
  for (const c of suite.cases) {
    if (c.status !== 'unsupported') continue;
    const entry = unsupportedByLanguage.get(c.benchmark.language) ?? {
      cases: 0,
      reason: c.statusReason ?? 'No analyzer available.',
    };
    entry.cases += 1;
    unsupportedByLanguage.set(c.benchmark.language, entry);
  }

  return {
    ranAt: suite.ranAt,
    capabilities: suite.capabilities,
    overall: { counts: overallCounts, metrics: computeMetrics(overallCounts) },
    byLanguage: group(measured, (c) => [c.benchmark.language]),
    byAnalyzer: group(measured, analyzersIn),
    byRule: group(measured, rulesIn),
    unsupported: [...unsupportedByLanguage.entries()]
      .map(([language, v]) => ({ language, cases: v.cases, reason: v.reason }))
      .sort((a, b) => a.language.localeCompare(b.language)),
    knownDefects: suite.cases
      .filter((c) => c.status === 'known-defect')
      .map((c) => ({
        id: c.benchmark.id,
        language: c.benchmark.language,
        reason: c.benchmark.knownDefect?.reason ?? 'unstated',
        owner: c.benchmark.knownDefect?.owner,
      })),
    skipped: suite.cases
      .filter((c) => c.status === 'skipped')
      .map((c) => ({ id: c.benchmark.id, reason: c.statusReason ?? 'unknown' })),
    benchmarks: {
      passed: suite.cases.filter((c) => c.status === 'pass').length,
      failed: suite.cases.filter((c) => c.status === 'fail').length,
      knownDefects: suite.cases.filter((c) => c.status === 'known-defect').length,
      skipped: suite.cases.filter((c) => c.status === 'skipped').length,
      unsupported: suite.cases.filter((c) => c.status === 'unsupported').length,
      total: suite.cases.length,
    },
    repair,
  };
}

const row = (cells: string[]): string => `| ${cells.join(' | ')} |`;

function groupTable(title: string, groups: Group[]): string[] {
  if (groups.length === 0) return [`### ${title}`, '', '_No measured cases._', ''];
  return [
    `### ${title}`,
    '',
    row(['Name', 'Accuracy', 'Precision', 'Recall', 'F1', 'TP', 'FP', 'FN', 'Cases']),
    row(['---', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:']),
    ...groups.map((g) =>
      row([
        g.name,
        formatRate(g.metrics.accuracy),
        formatRate(g.metrics.precision),
        formatRate(g.metrics.recall),
        formatRate(g.metrics.f1),
        String(g.counts.truePositives),
        String(g.counts.falsePositives),
        String(g.counts.falseNegatives),
        String(g.cases),
      ]),
    ),
    '',
  ];
}

/** Failures, in full. The point of the report is that a bad result is as visible as a good one. */
function failureDetail(suite: SuiteResult): string[] {
  // Known defects are listed separately; this section is for unexplained failures only.
  const failures = suite.cases.filter((c) => c.status === 'fail');
  if (failures.length === 0) return ['### Failures', '', '_None._', ''];

  const lines = ['### Failures', ''];
  for (const c of failures) {
    lines.push(`#### \`${c.benchmark.id}\` — ${c.benchmark.description}`, '');
    for (const o of c.outcomes) {
      if (o.kind === 'false-negative') {
        lines.push(
          `- **MISSED** \`${o.expected.ruleId}\` expected at \`${o.expected.file}:${String(o.expected.line)}\` from \`${o.expected.analyzer}\`` +
            (o.expected.note === undefined ? '' : ` — ${o.expected.note}`),
        );
      } else if (o.kind === 'false-positive') {
        lines.push(
          `- **UNEXPECTED** \`${o.actual.ruleId}\` (${o.actual.severity}) at \`${o.actual.location.file}:${String(o.actual.location.startLine)}\` from \`${o.actual.source}\` — "${o.actual.message}"`,
        );
      } else if (o.kind === 'attribute-mismatch') {
        const detail = o.mismatches
          .map((m) => `${m.attribute} expected ${m.expected}, got ${m.actual}`)
          .join('; ');
        lines.push(`- **MISMATCH** \`${o.expected.ruleId}\` at \`${o.expected.file}\` — ${detail}`);
      }
    }
    lines.push('');
  }
  return lines;
}

export function renderReport(dashboard: Dashboard, suite: SuiteResult): string {
  const m = dashboard.overall.metrics;
  const c = dashboard.overall.counts;
  const b = dashboard.benchmarks;

  const lines: string[] = [
    '# Fixora — Analyzer Accuracy Report',
    '',
    `Generated ${dashboard.ranAt} from a real execution of the analysis engine.`,
    'Every number below is measured. Anything not measured is marked `n/a` with a reason.',
    '',
    '## Accuracy Dashboard',
    '',
    row(['Metric', 'Value']),
    row(['---', '---:']),
    row(['**Overall accuracy**', `**${formatRate(m.accuracy)}**`]),
    row(['Precision', formatRate(m.precision)]),
    row(['Recall', formatRate(m.recall)]),
    row(['F1', formatRate(m.f1)]),
    row(['False-positive rate', formatRate(m.falsePositiveRate)]),
    row(['False-negative rate', formatRate(m.falseNegativeRate)]),
    row(['Attribute error rate', formatRate(m.attributeErrorRate)]),
    row(['True positives', String(c.truePositives)]),
    row(['False positives', String(c.falsePositives)]),
    row(['False negatives', String(c.falseNegatives)]),
    row(['Attribute mismatches', String(c.attributeMismatches)]),
    row([
      'Benchmarks passed',
      `${String(b.passed)} / ${String(b.passed + b.failed + b.knownDefects)} scored`,
    ]),
    row(['Benchmarks failing (known defects)', String(b.knownDefects)]),
    row(['Benchmarks skipped', String(b.skipped)]),
    row(['Benchmarks unsupported', String(b.unsupported)]),
    '',
  ];

  lines.push(...groupTable('Per language', dashboard.byLanguage));
  lines.push(...groupTable('Per analyzer', dashboard.byAnalyzer));
  lines.push(...groupTable('Per rule', dashboard.byRule));

  // Performance (M6 §4). Measured wall-clock over the scored cases actually run this session — a real
  // number for this machine, not a target. Repair/apply timings live in the Repair section, which is
  // honest about needing a provider key.
  const timed = suite.cases.filter(
    (x) => x.status === 'pass' || x.status === 'fail' || x.status === 'known-defect',
  );
  const totalMs = timed.reduce((sum, x) => sum + x.durationMs, 0);
  const totalFiles = timed.reduce((sum, x) => sum + x.analyzedFileCount, 0);
  lines.push('### Performance', '');
  if (timed.length === 0) {
    lines.push('_No scored cases were run._', '');
  } else {
    lines.push(
      row(['Metric', 'Value']),
      row(['---', '---:']),
      row(['Average analysis time / case', `${(totalMs / timed.length).toFixed(1)} ms`]),
      row([
        'Average analysis time / file',
        totalFiles === 0 ? 'n/a' : `${(totalMs / totalFiles).toFixed(1)} ms`,
      ]),
      row(['Total analysis time', `${(totalMs / 1000).toFixed(2)} s`]),
      row(['Scored cases run', `${String(timed.length)} (${String(totalFiles)} files)`]),
      '',
      '_Wall-clock on this machine, this run. Small cases, so per-case time is dominated by process_',
      '_startup (spawning eslint/tsc/ruff), not analysis of the file — read it as an order of magnitude._',
      '',
    );
  }

  // The gap, stated as a gap. Never a score.
  lines.push('### Unsupported languages', '');
  if (dashboard.unsupported.length === 0) {
    lines.push('_None._', '');
  } else {
    lines.push(row(['Language', 'Cases', 'Status', 'Reason']), row(['---', '---:', '---', '---']));
    for (const u of dashboard.unsupported) {
      lines.push(
        row([
          u.language,
          String(u.cases),
          '**No analyzer available**',
          u.reason.replace(/\n/g, ' '),
        ]),
      );
    }
    lines.push(
      '',
      'These are **not** scored. They are excluded from every accuracy figure above, because a',
      'language with no analyzer has no accuracy — reporting 0% would imply a broken analyzer and',
      '100% would be a vacuous pass. They are counted here so the gap stays visible.',
      '',
    );
  }

  if (dashboard.skipped.length > 0) {
    lines.push('### Skipped (tool unavailable on this machine)', '');
    for (const s of dashboard.skipped) lines.push(`- \`${s.id}\` — ${s.reason}`);
    lines.push('', 'A skipped case is a fact about the runner, not about Fixora. Not scored.', '');
  }

  lines.push('### Known defects', '');
  if (dashboard.knownDefects.length === 0) {
    lines.push('_None._', '');
  } else {
    lines.push(
      'These cases fail deliberately. The expectation states what Fixora **should** report; the',
      'failure is a defect in Fixora, tracked rather than papered over. They are **included** in the',
      'accuracy figures above — a known miss is still a miss.',
      '',
    );
    for (const k of dashboard.knownDefects) {
      lines.push(
        `- **\`${k.id}\`** (${k.language}${k.owner === undefined ? '' : `, owner: ${k.owner}`})`,
      );
      lines.push(`  ${k.reason}`, '');
    }
  }

  lines.push(...failureDetail(suite));

  // Repair.
  lines.push('### Repair', '');
  if (!dashboard.repair.measured) {
    lines.push(
      row(['Metric', 'Value']),
      row(['---', '---:']),
      row(['Repair success rate', '**Not Measured (Provider Required)**']),
      row(['Verification success rate', '**Not Measured (Provider Required)**']),
      row(['Regression rate', '**Not Measured (Provider Required)**']),
      '',
      dashboard.repair.reason,
      '',
    );
  } else {
    const r = dashboard.repair;
    lines.push(
      row(['Metric', 'Value']),
      row(['---', '---:']),
      row(['Repairs attempted', String(r.attempted)]),
      row([
        'Verification success rate',
        formatRate(r.attempted === 0 ? null : r.verified / r.attempted),
      ]),
      row(['Apply success rate', formatRate(r.attempted === 0 ? null : r.applied / r.attempted)]),
      row(['Regression rate', formatRate(r.attempted === 0 ? null : r.regressions / r.attempted)]),
      '',
    );
  }

  lines.push(
    '### Toolchain',
    '',
    'Accuracy is a property of Fixora **and** the tools it drives, so the exact versions are recorded.',
    '',
    row(['Tool', 'Version']),
    row(['---', '---']),
    ...Object.entries(dashboard.capabilities.versions).map(([t, v]) => row([t, v])),
    '',
    '### Confidence',
    '',
    confidenceStatement(dashboard),
    '',
  );

  return lines.join('\n');
}

/**
 * How much the headline number is actually worth.
 *
 * A precision figure over a handful of findings is not a measurement of the engine, it is a
 * measurement of a handful of findings. Saying so is the difference between a report and a
 * marketing number.
 */
function confidenceStatement(d: Dashboard): string {
  const total = d.overall.counts.truePositives + d.overall.counts.falseNegatives;
  const scoredCases = d.benchmarks.passed + d.benchmarks.failed;
  const parts = [
    `Measured over **${String(total)} expected findings** across **${String(scoredCases)} scored benchmark cases**.`,
  ];
  if (total < 30) {
    parts.push(
      `This is a **small sample**. With ${String(total)} expected findings, a single miss moves recall by ` +
        `roughly ${(100 / Math.max(total, 1)).toFixed(1)} points, so the headline percentage should be read as ` +
        'an indication rather than a stable rate. Growing the dataset is the highest-value next step.',
    );
  }
  if (d.benchmarks.unsupported > 0) {
    parts.push(
      `**${String(d.benchmarks.unsupported)} cases are unsupported** and contribute nothing to the figures above. ` +
        'Fixora currently has no analyzer for those languages.',
    );
  }
  if (d.benchmarks.skipped > 0) {
    parts.push(
      `**${String(d.benchmarks.skipped)} cases were skipped** because their tool is not installed here; ` +
        'the same suite on a machine with those tools will measure more.',
    );
  }
  if (!d.repair.measured) {
    parts.push('**Repair accuracy is unmeasured.** No provider key was available for this run.');
  }
  return parts.join(' ');
}
