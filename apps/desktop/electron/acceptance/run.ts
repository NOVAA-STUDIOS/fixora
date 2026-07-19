/**
 * Real-API, real-pipeline acceptance run for release blocker B4.
 *
 * This is NOT part of the shipped app: it is only built when FIXORA_ACCEPTANCE=1, so a production
 * bundle is byte-identical without it.
 *
 * Every stage is the code the app runs. The analysis worker is the real utility process, the provider
 * is the real OpenRouter adapter reached through `createAiService`'s default factory, verification is
 * the real overlay service, and apply is the same read-check-splice-write sequence as the
 * `ai:applyRepair` handler — including the staleness guard.
 *
 * Two disclosed substitutions, both storage rather than pipeline:
 *  - the findings and history repositories are in-memory. The findings they serve come from the real
 *    analyzer, so verification still compares against a genuine baseline.
 *  - the workspace service is a stub around a temp directory, because there is no window to open one.
 *
 * The key is decrypted in-process via safeStorage, under the app's own profile. It is never printed.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Finding } from '@fixora/shared-types';
import { app, safeStorage } from 'electron';

import { createAiService } from '../main/ai/ai-service.js';
import type { KeyStore } from '../main/ai/key-store.js';
import { createAnalysisHost, type AnalysisTargetRef } from '../main/analysis/analysis-host.js';
import type {
  FindingsRepository,
  RepairHistoryRepository,
} from '../main/db/repositories.js';
import type { WorkspaceService } from '../main/services/workspace-service.js';
import { sliceLines, spliceLines } from '../main/verification/patch.js';
import { createVerificationService } from '../main/verification/verification-service.js';

interface Case {
  language: string;
  file: string;
  /** Source containing one real, analyzer-detectable defect. */
  source: string;
}

/**
 * One defect per language, each chosen to be something the workspace's analyzers actually flag —
 * not a stylistic preference, and not a bug that only a human would call a bug.
 */
const CASES: Case[] = [
  {
    language: 'JavaScript',
    file: 'src/total.js',
    source: `export function total(items) {
  let sum = 0;
  for (let i = 0; i <= items.length; i++) {
    sum += items[i];
  }
  return sum;
}
`,
  },
  {
    language: 'TypeScript',
    file: 'src/average.ts',
    source: `export function average(nums: number[]): number {
  let total = 0;
  for (let i = 0; i <= nums.length; i++) {
    total += nums[i];
  }
  return total / nums.length;
}
`,
  },
  {
    language: 'React',
    file: 'src/Counter.tsx',
    source: `import { useState, useEffect } from 'react';

export function Counter({ start }: { start: number }) {
  const [count, setCount] = useState(start);
  useEffect(() => {
    setCount(start);
  });
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
`,
  },
  {
    language: 'HTML',
    file: 'public/index.html',
    source: `<!doctype html>
<html>
  <head><title>Demo</title></head>
  <body>
    <img src="logo.png">
    <p>Hello
  </body>
</html>
`,
  },
  {
    language: 'CSS',
    file: 'src/styles.css',
    source: `.card {
  color: #333
  background: white;
  padding: 8px;
}
`,
  },
  {
    language: 'JSON',
    file: 'data/config.json',
    source: `{
  "name": "demo",
  "version": "1.0.0",
  "scripts": {
    "build": "tsc",
  }
}
`,
  },
  {
    language: 'Python',
    file: 'src/stats.py',
    source: `def mean(values):
    total = 0
    for i in range(len(values) + 1):
        total += values[i]
    return total / len(values)
`,
  },
];

interface CaseResult {
  language: string;
  file: string;
  detected: number;
  rule?: string;
  message?: string;
  verdict?: string;
  ran?: readonly string[];
  applied?: boolean;
  beforeCount?: number;
  afterCount?: number;
  before?: string;
  after?: string;
  ms?: number;
  error?: string;
}

// Electron does not forward this process's stdout or stderr to the shell that launched it on
// Windows, so an uncaught throw is indistinguishable from a silent exit. Catch both channels and put
// them somewhere readable before doing anything else.
process.on('uncaughtException', (error: Error) => {
  writeFileSync(
    'C:/dev/FIXORA/apps/desktop/release/acceptance-fatal.log',
    `uncaughtException: ${error.message}\n${error.stack ?? ''}\n`,
  );
  process.exit(1);
});
process.on('unhandledRejection', (reason: unknown) => {
  writeFileSync(
    'C:/dev/FIXORA/apps/desktop/release/acceptance-fatal.log',
    `unhandledRejection: ${reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : String(reason)}\n`,
  );
  process.exit(1);
});

// Adopt the app's own identity before anything reads a path or touches safeStorage. On Windows the
// encryption key is per-profile (Chromium OSCrypt, DPAPI-protected in that profile's Local State), so
// running as the default "Electron" profile cannot decrypt what Fixora wrote.
app.setName('@fixora/desktop');
app.setPath('userData', join(app.getPath('appData'), '@fixora', 'desktop'));

/** Where this run's artefacts land. Absolute, decided at build time. */
const OUT_DIR = 'C:/dev/FIXORA/apps/desktop/release';

function log(line: string): void {
  // An absolute path fixed at build time: `app.getAppPath()` points at Electron's own dist when the
  // harness is run as a bare script, which is how the first run wrote its log into the void.
  const file = join(OUT_DIR, 'acceptance.log');
  try {
    writeFileSync(file, `${new Date().toISOString()} ${line}\n`, { flag: 'a' });
  } catch {
    /* never let tracing fail the run */
  }
}

async function main(): Promise<number> {
  await app.whenReady();

  // ---- the app's own profile, so safeStorage can decrypt what the app wrote ----
  const credentialsPath = join(app.getPath('userData'), 'ai-credentials.json');
  const stored = JSON.parse(readFileSync(credentialsPath, 'utf8')) as {
    keyEnc: string;
    model: string;
  };
  const apiKey = safeStorage.decryptString(Buffer.from(stored.keyEnc, 'base64'));
  const model = stored.model;

  // ---- a real workspace on disk ----
  const root = mkdtempSync(join(tmpdir(), 'fixora-acceptance-'));
  const results: CaseResult[] = [];

  const workerPath = join(OUT_DIR, '..', 'out', 'main', 'analysis-worker.mjs');
  const host = createAnalysisHost(workerPath);
  const verification = createVerificationService({ host });

  const analyze = (targets: AnalysisTargetRef[]): Promise<Map<string, Finding[]>> =>
    new Promise((resolve, reject) => {
      const found = new Map<string, Finding[]>();
      host.run({
        id: `analyze-${String(Date.now())}`,
        workspaceRoot: root,
        targets,
        onFileFindings: (file, findings) => found.set(file, findings),
        onDone: () => {
          resolve(found);
        },
        onError: reject,
      });
    });

  for (const testCase of CASES) {
    const started = Date.now();
    const result: CaseResult = { language: testCase.language, file: testCase.file, detected: 0 };
    try {
      const abs = join(root, testCase.file);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, testCase.source);

      const target: AnalysisTargetRef = {
        file: testCase.file,
        absPath: abs,
        language: testCase.file.split('.').pop() ?? '',
      };

      // ---- 1. detect, for real ----
      const before = await analyze([target]);
      const baseline = before.get(testCase.file) ?? [];
      result.detected = baseline.length;
      result.beforeCount = baseline.length;
      if (baseline.length === 0) {
        result.error = 'no finding detected — nothing to repair';
        results.push(result);
        continue;
      }
      const finding = baseline[0] as Finding;
      result.rule = finding.ruleId;
      result.message = finding.message;

      // ---- 2. the real service: provider call + overlay verification ----
      const keyStore: KeyStore = {
        getKey: () => apiKey,
        getConfig: () => ({ configured: true, model, keyHint: null, migratedFrom: null }),
        hasKey: () => true,
        setKey: () => ({ configured: true, model, keyHint: null, migratedFrom: null }),
        clearKey: () => ({ configured: false, model, keyHint: null, migratedFrom: null }),
        setModel: () => ({ configured: true, model, keyHint: null, migratedFrom: null }),
      };
      const findings = {
        getByFindingId: () => finding,
        list: () => baseline,
      } as unknown as FindingsRepository;
      const workspace = {
        getCurrent: () => ({ id: 'acceptance', rootPath: root, name: 'acceptance', ignore: [] }),
      } as unknown as WorkspaceService;
      const history = {
        record: () => 'h1',
        markApplied: () => undefined,
        list: () => [],
        clearWorkspace: () => undefined,
      } as unknown as RepairHistoryRepository;

      // No providerFactory: the default is the real OpenRouter adapter.
      const ai = createAiService({ keyStore, findings, workspace, verification, history });
      const response = await ai.run(
        { profile: 'repair', findingId: finding.id } as never,
        null,
      );

      const proposal = (response as { proposal?: Record<string, unknown> }).proposal;
      const report = proposal?.['verification'] as { verdict?: string; ran?: string[] } | undefined;
      result.verdict = report?.verdict ?? (response as { status?: string }).status ?? 'no-proposal';
      result.ran = report?.ran ?? [];

      // ---- 3. apply, exactly as ai:applyRepair does (including the staleness guard) ----
      if (result.verdict === 'verified') {
        const startLine = proposal?.['startLine'] as number;
        const endLine = proposal?.['endLine'] as number;
        const code = proposal?.['repairedCode'] as string;
        const expectedOriginal = proposal?.['originalCode'] as string;
        const current = readFileSync(abs, 'utf8');
        if (sliceLines(current, startLine, endLine) !== expectedOriginal) {
          result.error = 'staleness guard rejected the patch';
        } else {
          result.before = sliceLines(current, startLine, endLine);
          writeFileSync(abs, spliceLines(current, startLine, endLine, code));
          result.after = code;
          result.applied = true;
        }
      }

      // ---- 4. re-analyze the real file on disk ----
      const after = await analyze([target]);
      result.afterCount = (after.get(testCase.file) ?? []).length;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }
    result.ms = Date.now() - started;
    log(`${result.language}: ${JSON.stringify(result)}`);
    results.push(result);
  }

  host.dispose();
  verification.dispose();

  const outFile = join(OUT_DIR, 'acceptance-report.json');
  mkdirSync(join(outFile, '..'), { recursive: true });
  writeFileSync(outFile, JSON.stringify({ model, root, results }, null, 2));
  rmSync(root, { recursive: true, force: true });

  const passed = results.filter((r) => r.verdict === 'verified' && r.applied === true).length;
  return passed === CASES.length ? 0 : 1;
}

main().then(
  (code) => {
    app.exit(code);
  },
  (error: unknown) => {
    log(`FATAL ${error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)}`);
    app.exit(1);
  },
);
