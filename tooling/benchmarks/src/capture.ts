import { readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  analyzeWorkspace,
  createAnalysisContext,
  detectCapabilities,
  languageForPath,
  type AnalysisFile,
} from '@fixora/core-analysis';
import type { Finding } from '@fixora/shared-types';

import { discoverCases } from './run.js';

/**
 * The authoring ground-truth tool.
 *
 *   pnpm capture            every case: print what the REAL analyzer reports
 *   pnpm capture <id-substr> only cases whose id contains the string
 *
 * A golden expectation must never be typed from memory — it has to be what the engine actually
 * produces (recorded verbatim) or a defect deliberately marked `knownDefect`. This prints each case's
 * real findings in the exact `ExpectedFinding` shape, so authoring a new case is: write the code, run
 * capture, eyeball that the findings are CORRECT (not an analyzer bug), paste them into the manifest.
 * It is deliberately separate from the scorer: capture tells you what IS, the manifest states what
 * SHOULD BE, and the gap between them is the measurement.
 */

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(here, '..', 'golden');

/** Mirror of the runner's file collection, kept in lock-step so capture sees exactly what scoring sees. */
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
      if (entry.name === 'fixora.bench.json') continue;
      const rel = relative(root, full).split(sep).join('/');
      const language = languageForPath(rel);
      if (language === null) continue;
      files.push({ file: rel, absPath: full, language });
    }
  };
  walk(root);
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

function asExpected(f: Finding): Record<string, unknown> {
  return {
    file: f.location.file,
    line: f.location.startLine,
    column: f.location.startCol,
    ruleId: f.ruleId,
    severity: f.severity,
    analyzer: f.source,
    repairAvailable: f.fixable,
    repair: f.repair,
  };
}

async function main(): Promise<void> {
  const filter = process.argv[2];
  const capabilities = await detectCapabilities(GOLDEN);
  const cases = discoverCases(GOLDEN).filter(
    (c) => filter === undefined || c.benchmark.id.includes(filter),
  );

  for (const { dir, benchmark } of cases) {
    if (benchmark.support === 'unsupported') continue;
    const files = collectFiles(dir);
    const context = createAnalysisContext({ root: dir, capabilities, files });
    const findings: Finding[] = [];
    for await (const finding of analyzeWorkspace({ context }, new AbortController().signal)) {
      findings.push(finding);
    }
    findings.sort(
      (a, b) => a.location.file.localeCompare(b.location.file) || a.location.startLine - b.location.startLine,
    );
    console.log(`\n# ${benchmark.id}  (${benchmark.language}, ${String(files.length)} file(s) analyzed)`);
    console.log(JSON.stringify(findings.map(asExpected), null, 2));
  }
}

void main();
