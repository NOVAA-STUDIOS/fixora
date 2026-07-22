import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { measureRepairs } from './repair.js';
import { buildDashboard, renderReport, type Dashboard, type RepairMeasurement } from './report.js';
import { runSuite } from './run.js';

/**
 * The benchmark CLI, and the CI gate.
 *
 *   pnpm bench           run, write the report and the baseline snapshot
 *   pnpm bench --check   run and compare against the committed baseline; non-zero on regression
 *
 * `--check` is what CI runs. It fails a pull request that makes Fixora less accurate, and it does so
 * by comparing measured numbers against measured numbers — never against a target someone typed in.
 */

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const GOLDEN = join(ROOT, 'golden');
const REPORT_MD = join(ROOT, 'results', 'accuracy-report.md');
const RESULT_JSON = join(ROOT, 'results', 'latest.json');
const BASELINE_JSON = join(ROOT, 'results', 'baseline.json');

/** The subset of the dashboard CI compares. Kept small so the baseline diff stays reviewable. */
type Baseline = {
  overall: { truePositives: number; falsePositives: number; falseNegatives: number };
  accuracy: number | null;
  benchmarks: { passed: number; failed: number };
};

const toBaseline = (d: Dashboard): Baseline => ({
  overall: {
    truePositives: d.overall.counts.truePositives,
    falsePositives: d.overall.counts.falsePositives,
    falseNegatives: d.overall.counts.falseNegatives,
  },
  accuracy: d.overall.metrics.accuracy,
  benchmarks: { passed: d.benchmarks.passed, failed: d.benchmarks.failed },
});

function compare(current: Baseline, baseline: Baseline): string[] {
  const regressions: string[] = [];

  // Accuracy. A null on either side means "not measured", and an unmeasured run cannot be compared
  // — reporting that as a pass would let a broken suite through silently, so it is a regression.
  if (baseline.accuracy !== null && current.accuracy === null) {
    regressions.push(
      'Accuracy is no longer measurable (previously measured). The suite produced no scored cases.',
    );
  } else if (
    baseline.accuracy !== null &&
    current.accuracy !== null &&
    current.accuracy < baseline.accuracy
  ) {
    regressions.push(
      `Accuracy fell from ${(baseline.accuracy * 100).toFixed(1)}% to ${(current.accuracy * 100).toFixed(1)}%.`,
    );
  }

  if (current.overall.falsePositives > baseline.overall.falsePositives) {
    regressions.push(
      `False positives rose from ${String(baseline.overall.falsePositives)} to ${String(current.overall.falsePositives)}.`,
    );
  }
  if (current.overall.falseNegatives > baseline.overall.falseNegatives) {
    regressions.push(
      `False negatives rose from ${String(baseline.overall.falseNegatives)} to ${String(current.overall.falseNegatives)}.`,
    );
  }
  if (current.benchmarks.failed > baseline.benchmarks.failed) {
    regressions.push(
      `Failing benchmarks rose from ${String(baseline.benchmarks.failed)} to ${String(current.benchmarks.failed)}.`,
    );
  }
  return regressions;
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');

  const suite = await runSuite(GOLDEN);
  const repair: RepairMeasurement = await measureRepairs();
  const dashboard = buildDashboard(suite, repair);

  mkdirSync(dirname(REPORT_MD), { recursive: true });
  writeFileSync(REPORT_MD, renderReport(dashboard, suite), 'utf8');
  writeFileSync(RESULT_JSON, `${JSON.stringify(dashboard, null, 2)}\n`, 'utf8');

  const b = dashboard.benchmarks;
  const acc = dashboard.overall.metrics.accuracy;
  console.log(
    `benchmarks: ${String(b.passed)} passed, ${String(b.failed)} failed, ` +
      `${String(b.skipped)} skipped, ${String(b.unsupported)} unsupported (${String(b.total)} total)`,
  );
  console.log(
    `accuracy:   ${acc === null ? 'n/a (nothing scored)' : `${(acc * 100).toFixed(1)}%`}`,
  );
  console.log(`report:     ${REPORT_MD}`);

  const current = toBaseline(dashboard);

  if (!check) {
    writeFileSync(BASELINE_JSON, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    console.log(`baseline:   written to ${BASELINE_JSON}`);
    // A local run reports failures but does not block; --check is the gate.
    process.exit(b.failed > 0 ? 1 : 0);
  }

  if (!existsSync(BASELINE_JSON)) {
    console.error('No baseline committed. Run `pnpm bench` and commit results/baseline.json.');
    process.exit(1);
  }
  const baseline = JSON.parse(readFileSync(BASELINE_JSON, 'utf8')) as Baseline;
  const regressions = compare(current, baseline);

  if (regressions.length > 0) {
    console.error('\nACCURACY REGRESSION — this change makes Fixora less accurate:\n');
    for (const r of regressions) console.error(`  - ${r}`);
    console.error(
      '\nIf the new numbers are correct and the old expectations were wrong, update the golden' +
        '\ndataset and the baseline in the same commit, and say why in the message. That is the' +
        '\nonly way an expectation is allowed to change.\n',
    );
    process.exit(1);
  }

  if (b.failed > 0) {
    console.error(`\n${String(b.failed)} benchmark(s) failing. See ${REPORT_MD}.`);
    process.exit(1);
  }

  console.log('\nNo accuracy regression.');
}

await main();
