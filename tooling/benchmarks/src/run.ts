import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import {
  analyzeWorkspace,
  createAnalysisContext,
  detectCapabilities,
  languageForPath,
  type AnalysisFile,
  type WorkspaceCapabilities,
} from '@fixora/core-analysis';
import type { Finding } from '@fixora/shared-types';

import { countOutcomes, type Counts } from './metrics.js';
import { matchFindings, type MatchOutcome } from './match.js';
import { parseManifest, type BenchmarkCase } from './schema.js';

/**
 * The benchmark runner.
 *
 * It drives the **real** engine — `detectCapabilities` + `createAnalysisContext` +
 * `analyzeWorkspace`, the same three calls the desktop app's analysis worker makes. Nothing is
 * stubbed and no findings are synthesised, because a benchmark that runs a mock measures the mock.
 */

const MANIFEST = 'fixora.bench.json';

/** Every case under `golden/`, discovered by the presence of a manifest. */
export function discoverCases(goldenRoot: string): { dir: string; benchmark: BenchmarkCase }[] {
  const out: { dir: string; benchmark: BenchmarkCase }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== MANIFEST) continue;
      const raw: unknown = JSON.parse(readFileSync(full, 'utf8'));
      out.push({ dir, benchmark: parseManifest(raw, relative(goldenRoot, full)) });
    }
  };
  walk(goldenRoot);
  return out.sort((a, b) => a.benchmark.id.localeCompare(b.benchmark.id));
}

/** Files the engine will analyze, i.e. those `languageForPath` recognises. */
function collectFiles(root: string): AnalysisFile[] {
  const files: AnalysisFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name === MANIFEST) continue;
      const rel = relative(root, full).split(sep).join('/');
      const language = languageForPath(rel);
      // null means the engine does not classify this file as analyzable at all — which is exactly
      // the state HTML/CSS/JSON are in, and why their cases are marked unsupported.
      if (language === null) continue;
      files.push({ file: rel, absPath: full, language });
    }
  };
  walk(root);
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

export type CaseResult = {
  benchmark: BenchmarkCase;
  status: 'pass' | 'fail' | 'known-defect' | 'skipped' | 'unsupported';
  /** Why, when the status is `skipped` or `unsupported`. */
  statusReason?: string;
  outcomes: MatchOutcome[];
  counts: Counts;
  /** Every file the engine actually analyzed. Zero here for an unsupported case, by definition. */
  analyzedFileCount: number;
  durationMs: number;
};

export async function runCase(
  dir: string,
  benchmark: BenchmarkCase,
  capabilities: WorkspaceCapabilities,
): Promise<CaseResult> {
  const started = Date.now();
  const base = {
    benchmark,
    outcomes: [] as MatchOutcome[],
    counts: countOutcomes([]),
    analyzedFileCount: 0,
  };

  if (benchmark.support === 'unsupported') {
    // Not run, not scored, not hidden. The report gives these their own section.
    return {
      ...base,
      status: 'unsupported',
      statusReason: benchmark.unsupportedReason ?? 'No analyzer available.',
      durationMs: Date.now() - started,
    };
  }

  const missing = benchmark.requiresTools.filter((t) => !capabilities.tools.has(t));
  if (missing.length > 0) {
    // A missing tool is a fact about this machine, not about Fixora. Scoring it would make the
    // accuracy number depend on what happens to be installed on the runner.
    return {
      ...base,
      status: 'skipped',
      statusReason: `Requires ${missing.join(', ')} — not available on this machine.`,
      durationMs: Date.now() - started,
    };
  }

  const files = collectFiles(dir);
  const context = createAnalysisContext({ root: dir, capabilities, files });
  const findings: Finding[] = [];
  for await (const finding of analyzeWorkspace({ context }, new AbortController().signal)) {
    findings.push(finding);
  }

  const outcomes = matchFindings(benchmark, findings);
  const counts = countOutcomes(outcomes);
  const failed =
    counts.falsePositives > 0 || counts.falseNegatives > 0 || counts.attributeMismatches > 0;
  // A declared known defect turns a failure into a tracked one. It still counts in the accuracy
  // maths — hiding it there would be the same dishonesty in a different place.
  const status = failed ? (benchmark.knownDefect === undefined ? 'fail' : 'known-defect') : 'pass';

  return {
    benchmark,
    status,
    ...(benchmark.knownDefect === undefined ? {} : { statusReason: benchmark.knownDefect.reason }),
    outcomes,
    counts,
    analyzedFileCount: files.length,
    durationMs: Date.now() - started,
  };
}

export type SuiteResult = {
  ranAt: string;
  capabilities: { tools: string[]; versions: Record<string, string> };
  cases: CaseResult[];
};

export async function runSuite(goldenRoot: string): Promise<SuiteResult> {
  const cases = discoverCases(goldenRoot);
  // Capabilities are detected once, at the golden root, so every case is measured against the same
  // toolchain — and the exact tool versions are recorded in the report.
  const capabilities = await detectCapabilities(goldenRoot);

  const results: CaseResult[] = [];
  for (const { dir, benchmark } of cases) {
    results.push(await runCase(dir, benchmark, capabilities));
  }

  return {
    ranAt: new Date().toISOString(),
    capabilities: {
      tools: [...capabilities.tools].sort(),
      versions: Object.fromEntries(
        [...capabilities.versions].sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
    cases: results,
  };
}
