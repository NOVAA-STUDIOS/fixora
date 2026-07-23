import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createOpenRouterProvider,
  fetchModelCatalogue,
  pickDefaultModel,
  PREFERRED_FREE_CODE_MODELS,
} from '@fixora/core-ai';
import { detectCapabilities } from '@fixora/core-analysis';

import { runProject, type AiRunner } from './harness.js';
import { discoverProjects } from './projects.js';
import { renderReport } from './report.js';
import type { RunResult } from './types.js';

/**
 * The validation CLI.
 *
 *   pnpm validate            run the harness over the corpus, write JSON + Markdown, exit non-zero if
 *                            any EXECUTED deterministic repair failed the loop (a real engine defect)
 *   pnpm validate:report     re-render the report from the last results JSON
 *   pnpm check-env           report whether the provider key is configured (value never printed)
 *
 * The provider key is read from `FIXORA_BENCH_OPENROUTER_KEY` — from the real environment, or from a
 * git-ignored `.env` at the repo root (loaded here via Node's built-in loader, no dependency). With a
 * key the AI leg runs for real; without one it is DEFERRED. The key is never printed or logged.
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
const REPO_ROOT = join(PKG_ROOT, '..', '..');
const DEFAULT_CORPUS = join(PKG_ROOT, 'projects');
const RESULTS_DIR = join(PKG_ROOT, 'results');
const RESULTS_JSON = join(RESULTS_DIR, 'validation-results.json');
const REPORT_MD = join(RESULTS_DIR, 'validation-report.md');
const KEY_ENV = 'FIXORA_BENCH_OPENROUTER_KEY';
const MODEL_ENV = 'FIXORA_BENCH_MODEL';

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Load a local `.env` into process.env if one exists, WITHOUT any dependency (Node's built-in
 * `process.loadEnvFile`, Node ≥ 20.12). The repo-root `.env` is the canonical place to paste the key;
 * a `.env` in the current directory is honoured too. Values already exported in the real environment
 * win — loadEnvFile does not overwrite existing keys. Failures are swallowed silently: a malformed or
 * unreadable file must never surface, because its contents may include the secret.
 */
function loadDotEnv(): void {
  for (const candidate of [join(REPO_ROOT, '.env'), join(process.cwd(), '.env')]) {
    if (!existsSync(candidate)) continue;
    try {
      process.loadEnvFile(candidate);
    } catch {
      /* never expose why — the file may contain the key */
    }
    return;
  }
}

/** Report whether the key is configured, WITHOUT ever printing its value. */
function checkEnv(): void {
  const key = (process.env[KEY_ENV] ?? '').trim();
  const model = (process.env[MODEL_ENV] ?? '').trim();
  if (key === '') {
    console.log(`${KEY_ENV}: NOT set — the AI Acceptance Run will DEFER the AI leg.`);
    console.log(`Paste your key into a .env file at the repo root: ${join(REPO_ROOT, '.env')}`);
  } else {
    // Length only — never the value, never a prefix of it.
    console.log(`${KEY_ENV}: detected (${String(key.length)} characters) — value NOT shown.`);
    console.log(
      `${MODEL_ENV}: ${model === '' ? 'not set (a free model will be auto-selected)' : model}`,
    );
    console.log('Ready for the Live AI Acceptance Run.');
  }
}

/**
 * Build the live-model leg from the environment, or null. The key is read ONLY from the environment,
 * never from disk or a profile, and is never printed. Model: FIXORA_BENCH_MODEL if set, else the
 * catalogue's default free code model, else the first preferred free model — chosen from the real
 * catalogue, never hardcoded blindly.
 */
async function buildAiRunner(): Promise<AiRunner | null> {
  const key = (process.env[KEY_ENV] ?? '').trim();
  if (key === '') return null;
  let model = (process.env[MODEL_ENV] ?? '').trim();
  if (model === '') {
    try {
      model = pickDefaultModel(await fetchModelCatalogue()) ?? PREFERRED_FREE_CODE_MODELS[0] ?? '';
    } catch {
      model = PREFERRED_FREE_CODE_MODELS[0] ?? '';
    }
  }
  if (model === '') return null;
  const provider = createOpenRouterProvider({ apiKey: key, appName: 'fixora-validation' });
  return { provider, model };
}

async function main(): Promise<void> {
  loadDotEnv();

  if (process.argv.includes('--check-env')) {
    checkEnv();
    return;
  }

  const corpus = argValue('--projects') ?? DEFAULT_CORPUS;
  const ai = await buildAiRunner();

  const projects = discoverProjects(corpus);
  const capabilities = await detectCapabilities(corpus);

  const run: RunResult = {
    ranAt: new Date().toISOString(),
    providerKeyPresent: ai !== null,
    projects: [],
  };
  for (const p of projects) {
    run.projects.push(await runProject(p, capabilities, PKG_ROOT, ai));
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
