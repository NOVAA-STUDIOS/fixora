/**
 * Q8 — baseline/overlay asymmetry, measured on the real pipeline.
 *
 * The audit left one open question: verification compares findings from TWO DIFFERENT analysis
 * environments. The baseline comes from the database, produced when the *workspace* was analyzed; the
 * patched set comes from a fresh analysis of a single file in a temporary *overlay*. Any difference
 * between those two environments — a project-scoped type-checker that behaves differently on one
 * file, a config that resolves differently, an edit since the last analysis — is charged to the patch
 * and surfaces as a regression, which disables Apply for a repair that is perfectly correct.
 *
 * That was a reasoned suspicion, not a measurement. This harness measures it, using the real analysis
 * worker (the utility process, not a stub) and the real verification service. No provider is involved:
 * the model is not what is under test, the verifier is, so the patch is supplied directly.
 *
 * It computes the verdict TWICE from the same patch:
 *
 *   A. `db-baseline`       — findings from analyzing the ORIGINAL file in the WORKSPACE (what the
 *                            database holds, and what verification used before this was fixed).
 *   B. `same-env-baseline` — findings from analyzing the ORIGINAL file in the OVERLAY, in the same
 *                            environment and moment as the patched analysis.
 *
 * If A and B disagree, Q8 is real and is the remaining blocker. If they agree, it is not.
 *
 * Run: FIXORA_ACCEPTANCE=1 pnpm build, then `electron out/main/verify-parity.js`.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import type { Finding } from '@fixora/shared-types';
import { app } from 'electron';

import { checksum } from '../main/ai/pipeline-trace.js';
import { createAnalysisHost } from '../main/analysis/analysis-host.js';
import { verificationSignature } from '../main/verification/patch.js';
import { createVerificationService } from '../main/verification/verification-service.js';

const OUT_DIR = 'C:/dev/FIXORA/apps/desktop/release';

function log(line: string): void {
  try {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'verify-parity.log'), `${line}\n`, { flag: 'a' });
  } catch {
    /* tracing must never fail the run */
  }
}

process.on('uncaughtException', (error: Error) => {
  log(`FATAL uncaughtException: ${error.message}\n${error.stack ?? ''}`);
  process.exit(1);
});
process.on('unhandledRejection', (reason: unknown) => {
  log(`FATAL unhandledRejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
  process.exit(1);
});

app.setName('@fixora/desktop');
app.setPath('userData', join(app.getPath('appData'), '@fixora', 'desktop'));

/**
 * The file under repair, and the patch.
 *
 * The source is the shape the user reported — a request helper whose reported problem sits partway
 * down the file, with unrelated, symbol-less findings BELOW it. The patch adds a line, which is what
 * makes every finding underneath shift, and shifting is what the positional-identity bug used to
 * charge to the patch.
 */
const REL_FILE = 'src/api/api.ts';

const ORIGINAL = [
  'export interface RequestOptions {',
  '  method?: string;',
  '  body?: unknown;',
  '}',
  '',
  'export class ApiClient {',
  '  private baseUrl: string;',
  '  private authToken: string | null = null;',
  '',
  '  constructor(baseUrl: string) {',
  '    this.baseUrl = baseUrl;',
  '  }',
  '',
  '  setToken(token: string): void {',
  '    this.authToken = token;',
  '  }',
  '',
  '  private buildHeaders(): Record<string, string> {',
  "    const headers: Record<string, string> = { 'Content-Type': 'application/json' };",
  '    if (this.authToken !== null) {',
  '      headers.Authorization = `Bearer ${this.authToken}`;',
  '    }',
  '    return headers;',
  '  }',
  '',
  '  async request(path: string, options: RequestOptions = {}): Promise<unknown> {',
  '    const headers = this.buildHeaders();',
  '    const response = fetch(`${this.baseUrl}${path}`, {',
  '      method: options.method,',
  '      headers,',
  '    });',
  '    const data = await response.json();',
  '    return data;',
  '  }',
  '}',
  '',
  'export function logRequest(path: string): void {',
  '  console.log(path);',
  '}',
  '',
  'export function logFailure(path: string): void {',
  '  console.log(path);',
  '}',
  '',
].join('\n');

/**
 * The correct repair for the reported problem, covering the enclosing method so the prerequisite
 * `await` on the `fetch` is included — exactly what scope escalation now produces.
 */
const REPAIRED = [
  '  async request(path: string, options: RequestOptions = {}): Promise<unknown> {',
  '    const headers = this.buildHeaders();',
  '    const response = await fetch(`${this.baseUrl}${path}`, {',
  '      method: options.method,',
  '      headers,',
  '    });',
  '    if (!response.ok) {',
  '      throw new Error(`Request failed: ${response.status}`);',
  '    }',
  '    const data = await response.json();',
  '    return data;',
  '  }',
].join('\n');

/** 1-based inclusive range of the `request` method in ORIGINAL — line 28 is the reported defect
 *  (`const response = fetch(...)`, unawaited), and 34 is the method's closing brace. */
const TARGET_START = 26;
const TARGET_END = 34;

function summarize(findings: readonly Finding[]): unknown[] {
  return findings.map((f) => ({
    source: f.source,
    ruleId: f.ruleId,
    line: f.location.startLine,
    symbol: f.evidence.enclosingSymbol?.name ?? null,
    signature: verificationSignature(f),
    message: f.message.slice(0, 90),
  }));
}

async function main(): Promise<number> {
  await app.whenReady();

  const root = mkdtempSync(join(tmpdir(), 'fixora-parity-'));
  const abs = join(root, REL_FILE);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, ORIGINAL, 'utf8');
  // A tsconfig so the TypeScript analyzer treats this as a real project rather than a loose file.
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', lib: ['ES2022', 'DOM'] } }, null, 2),
  );
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'parity-fixture', version: '1.0.0' }, null, 2));

  const workerPath = join(OUT_DIR, '..', 'out', 'main', 'analysis-worker.mjs');
  const host = createAnalysisHost(workerPath);
  const verification = createVerificationService({ host });

  const analyzeIn = (workspaceRoot: string, absPath: string): Promise<Finding[]> =>
    new Promise((resolve, reject) => {
      const found: Finding[] = [];
      host.run({
        id: `analyze-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`,
        workspaceRoot,
        targets: [{ file: REL_FILE, absPath, language: 'ts' }],
        onFileFindings: (_file, findings) => found.push(...findings),
        onDone: () => {
          resolve(found);
        },
        onError: reject,
      });
    });

  // ---- A. the DATABASE baseline: the original file analyzed in the real workspace ----
  const dbBaseline = await analyzeIn(root, abs);

  // ---- the patched file, and the real verification run against the DB baseline ----
  const { report, verifyId } = await verification.verify({
    finding: dbBaseline.find((f) => f.location.startLine >= TARGET_START && f.location.startLine <= TARGET_END) ?? null,
    repairedCode: REPAIRED,
    target: { file: REL_FILE, startLine: TARGET_START, endLine: TARGET_END, language: 'typescript' },
    workspaceRoot: root,
    originalContent: ORIGINAL,
    originalFindings: dbBaseline,
  });

  // ---- B. the SAME-ENVIRONMENT baseline: the ORIGINAL file analyzed inside an overlay ----
  // Built the way verification builds its own overlay, so the only difference from the patched run is
  // the file's contents.
  const overlayRoot = mkdtempSync(join(tmpdir(), 'fixora-parity-overlay-'));
  const overlayAbs = join(overlayRoot, REL_FILE);
  mkdirSync(join(overlayAbs, '..'), { recursive: true });
  writeFileSync(overlayAbs, ORIGINAL, 'utf8');
  writeFileSync(join(overlayRoot, 'tsconfig.json'), readFileSync(join(root, 'tsconfig.json'), 'utf8'));
  writeFileSync(join(overlayRoot, 'package.json'), readFileSync(join(root, 'package.json'), 'utf8'));
  const sameEnvBaseline = await analyzeIn(overlayRoot, overlayAbs);

  const patchedContent = [
    ...ORIGINAL.split('\n').slice(0, TARGET_START - 1),
    ...REPAIRED.split('\n'),
    ...ORIGINAL.split('\n').slice(TARGET_END),
  ].join('\n');

  const capture = {
    file: REL_FILE,
    targetRange: `${String(TARGET_START)}-${String(TARGET_END)}`,
    verificationRequestId: verifyId ?? null,

    baselineChecksum: checksum(ORIGINAL),
    overlayChecksum: checksum(patchedContent),
    patchChecksum: checksum(REPAIRED),

    dbBaselineCount: dbBaseline.length,
    dbBaselineFindings: summarize(dbBaseline),

    sameEnvBaselineCount: sameEnvBaseline.length,
    sameEnvBaselineFindings: summarize(sameEnvBaseline),

    baselineSignaturesDiffer:
      JSON.stringify([...new Set(dbBaseline.map(verificationSignature))].sort()) !==
      JSON.stringify([...new Set(sameEnvBaseline.map(verificationSignature))].sort()),

    verificationReport: report,
    applyGateInput: {
      repairedCodeLength: REPAIRED.length,
      syntaxOk: report.syntaxOk,
      verdict: report.verdict,
    },
    applyEnabled: REPAIRED.length > 0 && report.syntaxOk && report.verdict !== 'regression',
  };

  /**
   * ---- Scenario 2: the realistic Q8 trigger — the file was EDITED after analysis ----
   *
   * Scenario 1 shows the two baselines agreeing when nothing has moved, which is the easy case. The
   * asymmetry that matters is temporal: the database holds findings from the last workspace analysis,
   * and the user has typed since. Here they add a line with its own, unrelated type error. The patch
   * under test still only fixes the original problem.
   *
   * With the DB baseline, that pre-existing-but-unanalyzed error is absent from the baseline set, so
   * verification sees it in the patched file, calls it new, and returns `regression` — Apply disabled
   * over a defect the user wrote themselves and the patch never touched. With a baseline computed
   * from the same content in the same environment, it is present on both sides and correctly ignored.
   */
  const editedContent = `${ORIGINAL}\nexport const brokenByUser: number = 'not a number';\n`;
  writeFileSync(abs, editedContent, 'utf8');

  const patchedAfterEdit = [
    ...editedContent.split('\n').slice(0, TARGET_START - 1),
    ...REPAIRED.split('\n'),
    ...editedContent.split('\n').slice(TARGET_END),
  ].join('\n');

  // The baseline the DATABASE still holds — computed before the user's edit.
  const staleVerdict = await verification.verify({
    finding: dbBaseline.find((f) => f.location.startLine >= TARGET_START && f.location.startLine <= TARGET_END) ?? null,
    repairedCode: REPAIRED,
    target: { file: REL_FILE, startLine: TARGET_START, endLine: TARGET_END, language: 'typescript' },
    workspaceRoot: root,
    originalContent: editedContent,
    originalFindings: dbBaseline,
  });

  // The baseline computed from the CURRENT content, in the same environment.
  const freshBaseline = await analyzeIn(root, abs);
  const freshVerdict = await verification.verify({
    finding: freshBaseline.find((f) => f.location.startLine >= TARGET_START && f.location.startLine <= TARGET_END) ?? null,
    repairedCode: REPAIRED,
    target: { file: REL_FILE, startLine: TARGET_START, endLine: TARGET_END, language: 'typescript' },
    workspaceRoot: root,
    originalContent: editedContent,
    originalFindings: freshBaseline,
  });

  const staleScenario = {
    editedChecksum: checksum(editedContent),
    patchedChecksum: checksum(patchedAfterEdit),
    dbBaselineCount: dbBaseline.length,
    freshBaselineCount: freshBaseline.length,
    freshBaselineFindings: summarize(freshBaseline),
    withStaleBaseline: {
      verdict: staleVerdict.report.verdict,
      newFindingCount: staleVerdict.report.newFindingCount,
      newFindings: staleVerdict.report.newFindings ?? [],
      applyEnabled: staleVerdict.report.syntaxOk && staleVerdict.report.verdict !== 'regression',
    },
    withSameEnvBaseline: {
      verdict: freshVerdict.report.verdict,
      newFindingCount: freshVerdict.report.newFindingCount,
      applyEnabled: freshVerdict.report.syntaxOk && freshVerdict.report.verdict !== 'regression',
    },
  };
  const q8IsReal =
    staleScenario.withStaleBaseline.applyEnabled !== staleScenario.withSameEnvBaseline.applyEnabled;

  log(JSON.stringify({ ...capture, staleScenario, q8IsReal }, null, 2));
  writeFileSync(
    join(OUT_DIR, 'verify-parity.json'),
    JSON.stringify({ ...capture, staleScenario, q8IsReal }, null, 2),
  );

  host.dispose();
  verification.dispose();
  return capture.applyEnabled ? 0 : 2;
}

main().then(
  (code) => {
    log(`exit ${String(code)} (${basename(REL_FILE)})`);
    app.exit(code);
  },
  (error: unknown) => {
    log(`FATAL ${error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)}`);
    app.exit(1);
  },
);
