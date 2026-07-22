import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  captureFindings,
  detectOnce,
  discoverSamples,
  runSample,
  writeExpected,
  type SampleResult,
} from './runner.js';

/**
 * The Certification CLI and release gate.
 *
 *   pnpm certify           run the pipeline, write the report, exit non-zero on any failure
 *   pnpm certify:record    re-derive every sample's expected findings from the analyzer
 *   pnpm certify:check     alias of certify (the gate CI runs)
 *
 * `record` is the ONLY way expectations are written, and it writes exactly what the analyzer produced —
 * so the suite can never drift into asserting something the engine does not actually do.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLES = join(here, '..', '..', '..', 'samples', 'certification');
const REPORT = join(here, '..', 'results', 'certification-report.md');

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`;
}

interface LangRoll {
  language: string;
  supported: number;
  passed: number;
  failed: number;
  skipped: number;
  unsupported: number;
  tp: number;
  fp: number;
  fn: number;
  detAttempted: number;
  detSucceeded: number;
  aiDeferred: number;
  regressions: number;
}

function roll(results: SampleResult[]): Map<string, LangRoll> {
  const m = new Map<string, LangRoll>();
  for (const r of results) {
    const lang = r.sample.language;
    let g = m.get(lang);
    if (g === undefined) {
      g = {
        language: lang,
        supported: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        unsupported: 0,
        tp: 0,
        fp: 0,
        fn: 0,
        detAttempted: 0,
        detSucceeded: 0,
        aiDeferred: 0,
        regressions: 0,
      };
      m.set(lang, g);
    }
    if (r.status === 'unsupported') g.unsupported += 1;
    else if (r.status === 'skipped') g.skipped += 1;
    else {
      g.supported += 1;
      if (r.status === 'pass') g.passed += 1;
      else g.failed += 1;
      g.tp += r.detection.truePositives;
      g.fp += r.detection.falsePositives;
      g.fn += r.detection.falseNegatives;
      g.detAttempted += r.repair.deterministicAttempted;
      g.detSucceeded += r.repair.deterministicSucceeded;
      g.aiDeferred += r.repair.aiDeferred;
      g.regressions += r.regressionsIntroduced;
    }
  }
  return m;
}

function renderReport(results: SampleResult[], ranAt: string): string {
  const langs = [...roll(results).values()].sort((a, b) => a.language.localeCompare(b.language));
  const failures = results.filter((r) => r.status === 'fail');
  const supported = results.filter((r) => r.status === 'pass' || r.status === 'fail');
  const totalTp = supported.reduce((s, r) => s + r.detection.truePositives, 0);
  const totalFp = supported.reduce((s, r) => s + r.detection.falsePositives, 0);
  const totalFn = supported.reduce((s, r) => s + r.detection.falseNegatives, 0);
  const detAtt = supported.reduce((s, r) => s + r.repair.deterministicAttempted, 0);
  const detSucc = supported.reduce((s, r) => s + r.repair.deterministicSucceeded, 0);
  const aiDef = supported.reduce((s, r) => s + r.repair.aiDeferred, 0);
  const avgMs = supported.length
    ? Math.round(supported.reduce((s, r) => s + r.durationMs, 0) / supported.length)
    : 0;

  const lines = [
    '# Fixora — Certification Report',
    '',
    `Generated ${ranAt} from a REAL execution of the engine over samples/certification.`,
    'Every number is measured. AI-only repairs are reported as deferred (a provider key is required to',
    'execute them) — never counted as a success. CSS/HTML have no analyzer and are marked unsupported.',
    '',
    '## Summary',
    '',
    `| Metric | Value |`,
    `| --- | ---: |`,
    `| Samples passed | ${String(supported.filter((r) => r.status === 'pass').length)} / ${String(supported.length)} scored |`,
    `| Detection precision | ${pct(totalTp, totalTp + totalFp)} |`,
    `| Detection recall | ${pct(totalTp, totalTp + totalFn)} |`,
    `| False positives | ${String(totalFp)} |`,
    `| False negatives | ${String(totalFn)} |`,
    `| Deterministic repairs succeeded | ${detAtt === 0 ? 'n/a' : `${String(detSucc)} / ${String(detAtt)} (${pct(detSucc, detAtt)})`} |`,
    `| AI repairs deferred (provider key required) | ${String(aiDef)} |`,
    `| Regressions introduced by repair | ${String(supported.reduce((s, r) => s + r.regressionsIntroduced, 0))} |`,
    `| Average pipeline time / sample | ${String(avgMs)} ms |`,
    '',
    '## Per language',
    '',
    row([
      'Language',
      'Passed',
      'Precision',
      'Recall',
      'FP',
      'FN',
      'Det.repair',
      'AI-deferred',
      'Unsupported',
    ]),
    row(['---', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:']),
  ];
  for (const g of langs) {
    lines.push(
      row([
        g.language,
        `${String(g.passed)}/${String(g.supported)}`,
        pct(g.tp, g.tp + g.fp),
        pct(g.tp, g.tp + g.fn),
        String(g.fp),
        String(g.fn),
        g.detAttempted === 0 ? '—' : `${String(g.detSucceeded)}/${String(g.detAttempted)}`,
        String(g.aiDeferred),
        String(g.unsupported),
      ]),
    );
  }
  lines.push('', '## Failures', '');
  if (failures.length === 0) lines.push('_None._', '');
  else {
    for (const f of failures) {
      lines.push(
        `- **${f.sample.id}** (${f.sample.language}): FP=${String(f.detection.falsePositives)} FN=${String(f.detection.falseNegatives)} regressions=${String(f.regressionsIntroduced)}`,
      );
    }
    lines.push('');
  }
  lines.push(
    '## Not certified here (honest)',
    '',
    '- **AI (model) repairs**: executing them needs a provider key; they are counted as *deferred*, not',
    '  as pass or fail. Run the keyed round-trip harness to certify the model leg.',
    '- **CSS / HTML**: no analyzer exists, so these samples are unsupported and scored nowhere.',
    '',
  );
  return lines.join('\n');
}

function row(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const samples = discoverSamples(SAMPLES);
  const capabilities = await detectOnce(SAMPLES);

  if (mode === '--record') {
    for (const { dir, sample } of samples) {
      const expected = await captureFindings(dir, sample, capabilities);
      writeExpected(dir, sample, expected);
    }
    console.log(`recorded expectations for ${String(samples.length)} samples`);
    return;
  }

  const results: SampleResult[] = [];
  for (const { dir, sample } of samples) results.push(await runSample(dir, sample, capabilities));

  const ranAt = new Date().toISOString();
  const report = renderReport(results, ranAt);
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, report, 'utf8');

  const scored = results.filter((r) => r.status === 'pass' || r.status === 'fail');
  const failed = scored.filter((r) => r.status === 'fail');
  console.log(
    `certification: ${String(scored.length - failed.length)} passed, ${String(failed.length)} failed, ` +
      `${String(results.filter((r) => r.status === 'skipped').length)} skipped, ` +
      `${String(results.filter((r) => r.status === 'unsupported').length)} unsupported (${String(results.length)} total)`,
  );
  console.log(`report: ${REPORT}`);
  if (failed.length > 0) process.exitCode = 1;
}

void main();
