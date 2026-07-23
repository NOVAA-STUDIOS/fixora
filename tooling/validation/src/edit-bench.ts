import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildEditContext,
  classifyIntent,
  createOpenRouterProvider,
  fetchModelCatalogue,
  parseEditOutput,
  pickDefaultModel,
  prepareEditRequest,
  PREFERRED_FREE_CODE_MODELS,
  type AIProvider,
  type ProviderRequest,
} from '@fixora/core-ai';
import {
  detectCapabilities,
  languageForPath,
  resolveEditScope,
  type WorkspaceCapabilities,
} from '@fixora/core-analysis';

import { EDIT_CASES, type EditCase } from './edit-cases.js';
import { spliceLines } from './generate.js';
import { analyze, runGates } from './harness.js';
import { collectFiles, discoverProjects, type DiscoveredProject } from './projects.js';

/**
 * The Proceed-Mode editing acceptance harness (P2.2, objectives 7 & 8).
 *
 * Runs the REAL editing pipeline end-to-end, headlessly: intent → scope (core-analysis) → context +
 * gate (core-ai) → AI generate (real OpenRouter when a key is present) → the SAME verification gates
 * the repair engine uses (parse → formatter → re-analyze/regression → apply → compile) → measured
 * record with latency. It reuses `runGates` in EDIT mode (finding: null); no verification logic is
 * duplicated. Without a key the AI leg is DEFERRED, never faked.
 */

type EditOutcome =
  | 'EDIT_APPLIED'
  | 'AI_GENERATE_FAILED'
  | 'VERIFICATION_FAILED'
  | 'REGRESSION_DETECTED'
  | 'APPLY_FAILED'
  | 'AI_DEFERRED'
  | 'UNKNOWN_INTENT'
  | 'UNSUPPORTED_LANGUAGE';

interface EditRecord {
  project: string;
  file: string;
  language: string;
  instruction: string;
  intent: string;
  scopeBasis: string | null;
  scopeLines: number | null;
  verifyVerdict: string | null;
  applied: boolean;
  compileOk: boolean | null;
  regression: boolean;
  latencyMs: number;
  outcome: EditOutcome;
  rootCause: string;
}

interface EditRunResult {
  ranAt: string;
  providerKeyPresent: boolean;
  model: string | null;
  records: EditRecord[];
}

const here = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(here, '..');
const CORPUS = join(PKG_ROOT, 'projects');
const RESULTS_DIR = join(PKG_ROOT, 'results');

async function streamText(
  provider: AIProvider,
  request: ProviderRequest,
  signal: AbortSignal,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  let text = '';
  for await (const event of provider.stream(request, signal)) {
    if (event.type === 'text_delta') text += event.text;
    else if (event.type === 'error') {
      return {
        ok: false,
        reason:
          event.message.trim() === ''
            ? `provider error (${event.providerCode})`
            : `${event.message} (${event.providerCode})`,
      };
    }
  }
  return { ok: true, text };
}

async function buildProvider(): Promise<{ provider: AIProvider; model: string } | null> {
  const key = (process.env['FIXORA_BENCH_OPENROUTER_KEY'] ?? '').trim();
  if (key === '') return null;
  let model = (process.env['FIXORA_BENCH_MODEL'] ?? '').trim();
  if (model === '') {
    try {
      model = pickDefaultModel(await fetchModelCatalogue()) ?? PREFERRED_FREE_CODE_MODELS[0] ?? '';
    } catch {
      model = PREFERRED_FREE_CODE_MODELS[0] ?? '';
    }
  }
  if (model === '') return null;
  return {
    provider: createOpenRouterProvider({ apiKey: key, appName: 'fixora-edit-bench' }),
    model,
  };
}

async function runCase(
  kase: EditCase,
  project: DiscoveredProject,
  capabilities: WorkspaceCapabilities,
  ai: { provider: AIProvider; model: string } | null,
): Promise<EditRecord> {
  const started = Date.now();
  const language = languageForPath(kase.file);
  const rec: EditRecord = {
    project: kase.project,
    file: kase.file,
    language: language ?? 'unsupported',
    instruction: kase.instruction,
    intent: classifyIntent(kase.instruction, language !== null ? { language } : {}).intent,
    scopeBasis: null,
    scopeLines: null,
    verifyVerdict: null,
    applied: false,
    compileOk: null,
    regression: false,
    latencyMs: 0,
    outcome: 'EDIT_APPLIED',
    rootCause: '',
  };
  const finish = (outcome: EditOutcome, rootCause: string): EditRecord => {
    rec.outcome = outcome;
    rec.rootCause = rootCause;
    rec.latencyMs = Date.now() - started;
    return rec;
  };

  // Language first: css/html have no grammar/analyzer, so they are unsupported regardless of intent.
  if (language === null) {
    return finish('UNSUPPORTED_LANGUAGE', 'no analyzer/grammar for this language (css/html)');
  }
  if (rec.intent === 'unknown')
    return finish('UNKNOWN_INTENT', 'instruction matched no known intent');

  const source = readFileSync(join(project.dir, kase.file), 'utf8');
  const scope = await resolveEditScope({
    source,
    language,
    filePath: kase.file,
    selectionStartLine: kase.selectionStartLine,
    ...(kase.selectionEndLine !== undefined ? { selectionEndLine: kase.selectionEndLine } : {}),
  });
  rec.scopeBasis = scope.basis;
  rec.scopeLines = scope.endLine - scope.startLine + 1;

  const context = buildEditContext({
    instruction: kase.instruction,
    intent: rec.intent as never,
    filePath: kase.file,
    language,
    target: {
      symbolName: scope.symbolName,
      startLine: scope.startLine,
      endLine: scope.endLine,
      text: scope.text,
    },
  });
  const prepared = prepareEditRequest(context, {
    model: ai?.model ?? 'none',
    maxOutputTokens: 4000,
  });
  if (!prepared.ok) return finish('AI_GENERATE_FAILED', 'secret gate blocked the request');

  if (ai === null)
    return finish('AI_DEFERRED', 'no provider key (FIXORA_BENCH_OPENROUTER_KEY absent)');

  // Generate (stream + one schema re-ask).
  const signal = new AbortController().signal;
  let out = await streamText(ai.provider, prepared.request, signal);
  if (!out.ok) return finish('AI_GENERATE_FAILED', out.reason);
  let parsed = parseEditOutput(out.text);
  if (!parsed.ok) {
    const retry: ProviderRequest = {
      ...prepared.request,
      messages: [
        ...prepared.request.messages,
        { role: 'assistant', content: out.text },
        { role: 'user', content: 'Return ONLY the JSON object matching the schema.' },
      ],
    };
    out = await streamText(ai.provider, retry, signal);
    if (!out.ok) return finish('AI_GENERATE_FAILED', out.reason);
    parsed = parseEditOutput(out.text);
  }
  if (!parsed.ok) return finish('AI_GENERATE_FAILED', `model output: ${parsed.reason}`);

  // Splice + verify through the SAME gates the repair engine uses, in edit mode (finding: null).
  const patched = spliceLines(source, scope.startLine, scope.endLine, parsed.value.editedCode);
  const files = collectFiles(project.dir);
  const beforeIds = new Set((await analyze(project.dir, files, capabilities)).map((f) => f.id));
  const { stages, terminal } = await runGates({
    project,
    file: kase.file,
    finding: null,
    language,
    patched,
    repairStage: { ran: true, ok: true, detail: 'model generated an edit' },
    successOutcome: 'AI_REPAIR_APPLIED',
    beforeIds,
    capabilities,
    baselineCompileOk: null,
    toolRoot: PKG_ROOT,
  });
  rec.verifyVerdict = stages.verification.ran
    ? stages.verification.ok
      ? 'verified'
      : 'failed'
    : 'n/a';
  rec.applied = stages.apply.ok;
  rec.compileOk = stages.compile.ran ? stages.compile.ok : null;
  rec.regression = terminal.finalOutcome === 'REGRESSION_DETECTED';

  const map: Record<string, EditOutcome> = {
    AI_REPAIR_APPLIED: 'EDIT_APPLIED',
    VERIFICATION_FAILED: 'VERIFICATION_FAILED',
    REGRESSION_DETECTED: 'REGRESSION_DETECTED',
    APPLY_FAILED: 'APPLY_FAILED',
  };
  return finish(map[terminal.finalOutcome] ?? 'VERIFICATION_FAILED', terminal.rootCause);
}

function renderReport(run: EditRunResult): string {
  const r = run.records;
  const supported = r.filter((x) => x.outcome !== 'UNSUPPORTED_LANGUAGE');
  const executed = supported.filter(
    (x) => x.outcome !== 'AI_DEFERRED' && x.outcome !== 'UNKNOWN_INTENT',
  );
  const applied = r.filter((x) => x.outcome === 'EDIT_APPLIED');
  const frac = (n: number, d: number): string =>
    d === 0 ? 'n/a' : `${String(n)} / ${String(d)} (${((n / d) * 100).toFixed(1)}%)`;
  const avg = (ns: number[]): string =>
    ns.length === 0 ? 'n/a' : `${String(Math.round(ns.reduce((s, n) => s + n, 0) / ns.length))} ms`;

  const lines = [
    '# Fixora — Proceed Mode Editing Acceptance Report (P2.2)',
    '',
    `Generated ${run.ranAt} from a REAL end-to-end run of the editing pipeline.`,
    `Provider key present: **${run.providerKeyPresent ? 'yes' : 'no'}**${run.model !== null ? ` — model \`${run.model}\`` : ''}.`,
    'Each edit runs intent → scope → context+gate → AI → parse → the SAME verification gates as repair',
    '(parse → formatter → re-analyze/regression → apply → compile), in edit mode (no target finding).',
    '',
    '## Summary (measured)',
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    `| Edit cases | ${String(r.length)} |`,
    `| Supported-language cases | ${String(supported.length)} |`,
    `| Executed (generated) | ${String(executed.length)} |`,
    `| **Edits applied (survived full verification)** | ${frac(applied.length, executed.length)} |`,
    `| Regressions rejected | ${String(r.filter((x) => x.regression).length)} |`,
    `| Verification failures | ${String(r.filter((x) => x.outcome === 'VERIFICATION_FAILED').length)} |`,
    `| Generate failures | ${String(r.filter((x) => x.outcome === 'AI_GENERATE_FAILED').length)} |`,
    `| Unsupported (css/html, no analyzer) | ${String(r.filter((x) => x.outcome === 'UNSUPPORTED_LANGUAGE').length)} |`,
    `| AI-deferred (no key) | ${String(r.filter((x) => x.outcome === 'AI_DEFERRED').length)} |`,
    `| Avg latency (executed) | ${avg(executed.map((x) => x.latencyMs))} |`,
    '',
    '## Per case (request → intent → scope → verify → apply → compile → outcome)',
    '',
    '| Language | File | Intent | Scope | Verify | Applied | Compile | Latency | Outcome |',
    '| --- | --- | --- | --- | --- | :-: | :-: | ---: | --- |',
  ];
  for (const x of r) {
    lines.push(
      `| ${x.language} | ${x.file} | ${x.intent} | ${x.scopeBasis ?? '—'}${x.scopeLines !== null ? ` (${String(x.scopeLines)}L)` : ''} | ${x.verifyVerdict ?? '—'} | ${x.applied ? '✓' : '—'} | ${x.compileOk === null ? '—' : x.compileOk ? '✓' : '✗'} | ${String(x.latencyMs)} ms | \`${x.outcome}\` |`,
    );
  }
  lines.push('', '## Failures (exact reason, reproducible)', '');
  const failures = r.filter(
    (x) => !['EDIT_APPLIED', 'UNSUPPORTED_LANGUAGE', 'AI_DEFERRED'].includes(x.outcome),
  );
  if (failures.length === 0) lines.push('_None among executed edits._', '');
  else
    for (const x of failures)
      lines.push(`- **${x.project}/${x.file}** \`${x.outcome}\` — ${x.rootCause}`);
  lines.push(
    '',
    '## Not measured here (explicit)',
    '',
    '- **CSS / HTML**: no analyzer or grammar in the engine — the edit cannot be AST-verified, so it is',
    '  reported unsupported (never applied blindly). A CSS/HTML analyzer is future work.',
    '- **AI edits** require a provider key; without one they are DEFERRED, never faked.',
    '',
  );
  return lines.join('\n');
}

function loadDotEnv(): void {
  for (const candidate of [join(PKG_ROOT, '..', '..', '.env'), join(process.cwd(), '.env')]) {
    if (!existsSync(candidate)) continue;
    try {
      process.loadEnvFile(candidate);
    } catch {
      /* never expose why — the file may contain the key */
    }
    return;
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const ai = await buildProvider();
  const projects = discoverProjects(CORPUS);
  const byName = new Map(projects.map((p) => [p.manifest.name, p]));
  const capabilities = await detectCapabilities(CORPUS);

  const records: EditRecord[] = [];
  for (const kase of EDIT_CASES) {
    const project = byName.get(kase.project);
    if (project === undefined) continue;
    records.push(await runCase(kase, project, capabilities, ai));
  }

  const run: EditRunResult = {
    ranAt: new Date().toISOString(),
    providerKeyPresent: ai !== null,
    model: ai?.model ?? null,
    records,
  };
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(
    join(RESULTS_DIR, 'edit-acceptance-results.json'),
    JSON.stringify(run, null, 2) + '\n',
  );
  writeFileSync(join(RESULTS_DIR, 'edit-acceptance-report.md'), renderReport(run));

  const applied = records.filter((x) => x.outcome === 'EDIT_APPLIED').length;
  const executed = records.filter(
    (x) => !['AI_DEFERRED', 'UNKNOWN_INTENT', 'UNSUPPORTED_LANGUAGE'].includes(x.outcome),
  ).length;
  console.log(
    `edit-acceptance: ${String(records.length)} cases, ${String(executed)} executed, ${String(applied)} applied, ` +
      `key=${ai !== null ? 'yes' : 'no'}`,
  );
  console.log(`report: ${join(RESULTS_DIR, 'edit-acceptance-report.md')}`);
  // The gate never fails on model-quality; a corrupt/broken RUNNER is the only failure worth a red exit.
  if (!existsSync(join(RESULTS_DIR, 'edit-acceptance-report.md'))) process.exitCode = 1;
}

void main();
