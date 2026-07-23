import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectCapabilities } from '@fixora/core-analysis';

import { runProject } from './harness.js';
import { discoverProjects } from './projects.js';
import { renderReport } from './report.js';
import type { RunResult } from './types.js';

/**
 * The validation CLI.
 *
 *   pnpm validate            run the harness over the corpus, write JSON + Markdown, exit non-zero if
 *                            any EXECUTED deterministic repair failed the loop (a real engine defect)
 *   pnpm validate:report     re-render the report from the last results JSON
 *
 * The gate is deliberately narrow: it fails on a deterministic repair that did not survive
 * Analyze→Repair→Verify→Apply→Re-analyze→Compile — that is an engine defect. It does NOT fail on
 * AI-deferred or manual findings, which are honest classifications, not failures.
 *
 * The corpus root defaults to ./projects but can be overridden with `--projects <dir>` so the same
 * harness runs against a real checkout (no key needed for the deterministic + analysis legs).
 */

const here = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(here, '..');
const DEFAULT_CORPUS = join(PKG_ROOT, 'projects');
const RESULTS_DIR = join(PKG_ROOT, 'results');
const RESULTS_JSON = join(RESULTS_DIR, 'validation-results.json');
const REPORT_MD = join(RESULTS_DIR, 'validation-report.md');

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const corpus = argValue('--projects') ?? DEFAULT_CORPUS;
  const providerKeyPresent = (process.env['FIXORA_BENCH_OPENROUTER_KEY'] ?? '').trim().length > 0;

  const projects = discoverProjects(corpus);
  const capabilities = await detectCapabilities(corpus);

  const run: RunResult = {
    ranAt: new Date().toISOString(),
    providerKeyPresent,
    projects: [],
  };
  for (const p of projects) {
    run.projects.push(await runProject(p, capabilities, PKG_ROOT));
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(RESULTS_JSON, JSON.stringify(run, null, 2) + '\n', 'utf8');
  writeFileSync(REPORT_MD, renderReport(run), 'utf8');

  const attempts = run.projects.flatMap((p) => p.attempts);
  const executed = attempts.filter((r) => r.repairability === 'safe-auto');
  const engineDefects = executed.filter((r) => r.finalOutcome !== 'SAFE_AUTO_REPAIR_APPLIED');

  console.log(
    `validation: ${String(projects.length)} projects, ${String(attempts.length)} findings, ` +
      `${String(executed.length)} deterministic attempts, ` +
      `${String(executed.length - engineDefects.length)} survived, ${String(engineDefects.length)} failed`,
  );
  console.log(`results: ${RESULTS_JSON}`);
  console.log(`report:  ${REPORT_MD}`);
  if (engineDefects.length > 0) {
    for (const d of engineDefects) {
      console.error(
        `  DEFECT ${d.project}/${d.file} ${d.source}:${d.ruleId} → ${d.finalOutcome} @ ${d.stage} (${d.subsystem}): ${d.rootCause}`,
      );
    }
    process.exitCode = 1;
  }
}

void main();
