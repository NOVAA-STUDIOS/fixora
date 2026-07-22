import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

import {
  analyzeWorkspace,
  applyEdits,
  createAnalysisContext,
  detectCapabilities,
  languageForPath,
  parse,
  type AnalysisFile,
  type WorkspaceCapabilities,
} from '@fixora/core-analysis';
import type { Finding, Language } from '@fixora/shared-types';

/**
 * The Fixora Certification Runner.
 *
 * For every sample it runs the pipeline for REAL — Analyze → (deterministic) Repair → Apply →
 * Re-analyze → Verify → Compile — against the actual engine, on a throwaway copy of the sample so the
 * source in the repo is never touched. Nothing is estimated:
 *   - Expected findings are DERIVED from the analyzer (record mode writes them; run mode checks them).
 *   - Repair is executed only for findings a tool ships a deterministic autofix for (safe-auto). A
 *     finding that needs a model is reported `ai-deferred`, never counted as a repair success — there
 *     is no provider in this gate, and a fabricated success is worse than an honest deferral.
 *   - A CSS/HTML sample is `unsupported` (no analyzer) and contributes to no accuracy figure.
 */

const MANIFEST = 'certification.json';

export interface ExpectedFinding {
  file: string;
  line: number;
  ruleId: string;
  severity: string;
  source: string;
  repair: string;
}

export interface CertificationSample {
  id: string;
  language: string;
  category: string;
  support: 'supported' | 'unsupported';
  requiresTools: string[];
  note: string;
  expected: { findings: ExpectedFinding[]; deterministicRepairable: number };
}

export interface SampleResult {
  sample: CertificationSample;
  status: 'pass' | 'fail' | 'skipped' | 'unsupported';
  reason?: string;
  detection: { truePositives: number; falsePositives: number; falseNegatives: number };
  repair: { deterministicAttempted: number; deterministicSucceeded: number; aiDeferred: number };
  regressionsIntroduced: number;
  durationMs: number;
}

const asExpected = (f: Finding): ExpectedFinding => ({
  file: f.location.file,
  line: f.location.startLine,
  ruleId: f.ruleId,
  severity: f.severity,
  source: f.source,
  repair: f.repair,
});

const key = (f: { file: string; line: number; ruleId: string }): string =>
  `${f.file}:${String(f.line)}:${f.ruleId}`;

export function discoverSamples(root: string): { dir: string; sample: CertificationSample }[] {
  const out: { dir: string; sample: CertificationSample }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== MANIFEST) continue;
      const sample = JSON.parse(readFileSync(full, 'utf8')) as CertificationSample;
      out.push({ dir, sample });
    }
  };
  walk(root);
  return out.sort((a, b) => a.sample.id.localeCompare(b.sample.id));
}

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
      if (language === null) continue;
      files.push({ file: rel, absPath: full, language });
    }
  };
  walk(root);
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

async function analyze(root: string, capabilities: WorkspaceCapabilities): Promise<Finding[]> {
  const files = collectFiles(root);
  const context = createAnalysisContext({ root, capabilities, files });
  const findings: Finding[] = [];
  for await (const f of analyzeWorkspace({ context }, new AbortController().signal))
    findings.push(f);
  return findings;
}

/** The findings the analyzer actually produces for a sample — the ground truth expectations are recorded from. */
export async function captureFindings(
  dir: string,
  sample: CertificationSample,
  capabilities: WorkspaceCapabilities,
): Promise<{ findings: ExpectedFinding[]; deterministicRepairable: number }> {
  if (sample.support === 'unsupported') return { findings: [], deterministicRepairable: 0 };
  const findings = await analyze(dir, capabilities);
  return {
    findings: findings
      .map(asExpected)
      .sort(
        (a, b) =>
          a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId),
      ),
    deterministicRepairable: findings.filter((f) => f.autofix !== undefined).length,
  };
}

/**
 * Run the full pipeline for one sample. Applies every deterministic autofix a file's findings carry
 * (offset-based, so multiple non-overlapping edits compose), re-analyzes the patched copy, and checks
 * the repaired findings are gone and nothing new appeared.
 */
export async function runSample(
  dir: string,
  sample: CertificationSample,
  capabilities: WorkspaceCapabilities,
): Promise<SampleResult> {
  const started = Date.now();
  const base: Omit<SampleResult, 'status' | 'durationMs'> = {
    sample,
    detection: { truePositives: 0, falsePositives: 0, falseNegatives: 0 },
    repair: { deterministicAttempted: 0, deterministicSucceeded: 0, aiDeferred: 0 },
    regressionsIntroduced: 0,
  };

  if (sample.support === 'unsupported') {
    return { ...base, status: 'unsupported', durationMs: Date.now() - started };
  }
  const missing = sample.requiresTools.filter((t) => !capabilities.tools.has(t));
  if (missing.length > 0) {
    return {
      ...base,
      status: 'skipped',
      reason: `requires ${missing.join(', ')}`,
      durationMs: Date.now() - started,
    };
  }

  // --- Analyze ---
  const before = await analyze(dir, capabilities);
  const beforeKeys = new Set(before.map((f) => key(asExpected(f))));
  // Detection is compared on file:line:ruleId (both sides are the SAME fresh analysis, no line shift).
  // Regression, though, compares BEFORE vs AFTER a repair that can DELETE lines — so it must use the
  // shift-stable finding id (hashes a normalised snippet, not the line), or removing an unused import
  // would flag every finding below it as "new" (the exact trap the verdict signature avoids).
  const beforeIds = new Set(before.map((f) => f.id));
  const expectedKeys = new Set(sample.expected.findings.map((f) => key(f)));
  const detection = {
    truePositives: [...expectedKeys].filter((k) => beforeKeys.has(k)).length,
    falsePositives: [...beforeKeys].filter((k) => !expectedKeys.has(k)).length,
    falseNegatives: [...expectedKeys].filter((k) => !beforeKeys.has(k)).length,
  };

  // --- Repair (deterministic only) + Apply on a throwaway copy ---
  const repair = { deterministicAttempted: 0, deterministicSucceeded: 0, aiDeferred: 0 };
  const overlay = mkdtempSync(join(tmpdir(), 'fx-cert-'));
  let regressionsIntroduced = 0;
  try {
    cpSync(dir, overlay, {
      recursive: true,
      filter: (src) => !src.endsWith(MANIFEST) && !src.includes(`${sep}node_modules${sep}`),
    });

    const repairedFindingIds = new Set<string>();
    const byFile = new Map<string, Finding[]>();
    for (const f of before) {
      const list = byFile.get(f.location.file);
      if (list === undefined) byFile.set(f.location.file, [f]);
      else list.push(f);
    }

    for (const [file, findings] of byFile) {
      const edits = findings.flatMap((f) => f.autofix?.edits ?? []);
      const aiHere = findings.filter((f) => f.repair === 'ai-required');
      repair.aiDeferred += aiHere.length;
      if (edits.length === 0) continue;
      repair.deterministicAttempted += 1;

      const absOverlay = join(overlay, file);
      const source = readFileSync(absOverlay, 'utf8');
      const patched = applyEdits(source, edits);
      if (patched === null) continue; // edits did not compose cleanly — not a success
      // Parser gate on the patched file (Verify).
      const lang = languageForPath(file) as Language;
      const tree = await parse(lang, patched, file);
      const parseOk = !tree.root.hasError;
      tree.dispose();
      if (!parseOk) continue;
      writeFileSync(absOverlay, patched, 'utf8');
      repair.deterministicSucceeded += 1;
      for (const f of findings) if (f.autofix !== undefined) repairedFindingIds.add(f.id);
    }

    // --- Re-analyze the patched copy → Verify + Compile ---
    if (repair.deterministicSucceeded > 0) {
      const after = await analyze(overlay, capabilities);
      const afterIds = new Set(after.map((f) => f.id));
      // Regression: a finding present after that was NOT present before (the repair broke something) —
      // compared by shift-stable id so a line move is not mistaken for a new problem.
      regressionsIntroduced = [...afterIds].filter((id) => !beforeIds.has(id)).length;
      // Every repaired finding must be gone (Verify the fix took).
      for (const id of repairedFindingIds) {
        if (afterIds.has(id)) regressionsIntroduced += 1; // repaired but still reported = failure
      }
    }
  } finally {
    rmSync(overlay, { recursive: true, force: true });
  }

  const detectionOk =
    detection.falsePositives === 0 && detection.falseNegatives === 0 && regressionsIntroduced === 0;
  return {
    ...base,
    detection,
    repair,
    regressionsIntroduced,
    status: detectionOk ? 'pass' : 'fail',
    durationMs: Date.now() - started,
  };
}

export async function detectOnce(root: string): Promise<WorkspaceCapabilities> {
  return detectCapabilities(root);
}

/** Write the derived expectations back into a sample's manifest (record mode). */
export function writeExpected(
  dir: string,
  sample: CertificationSample,
  expected: CertificationSample['expected'],
): void {
  const next = { ...sample, expected };
  writeFileSync(join(dir, MANIFEST), JSON.stringify(next, null, 2) + '\n', 'utf8');
}

export { dirname };
