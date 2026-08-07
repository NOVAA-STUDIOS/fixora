import type { EditScope, MicroRepairResult } from '@fixora/core-analysis';
import type { Finding, Language } from '@fixora/shared-types';
import { utilityProcess, type UtilityProcess } from 'electron';

/**
 * The host side of the analysis utility process (ADR-017). It owns the worker's lifecycle — lazy
 * spawn, one job at a time, a hard timeout, cancellation, and **restart on crash** — so that a
 * runaway parse or a wedged tool degrades to "analysis failed for this run", never a frozen editor.
 * A crashed worker takes down one panel; main and the editor (with the user's unsaved work) live on.
 */

export interface AnalysisTargetRef {
  file: string;
  absPath: string;
  language: string;
}

export interface AnalysisJob {
  id: string;
  workspaceRoot: string;
  targets: AnalysisTargetRef[];
  timeoutMs?: number;
  onFileFindings: (file: string, findings: Finding[]) => void;
  onDone: (aborted: boolean) => void;
  onError: (message: string) => void;
}

export interface SyntaxError {
  line: number;
  column: number;
  text: string;
}

export interface FormatterGateResult {
  ran: boolean;
  ok: boolean;
  formatter?: string;
  message?: string;
}

export interface VerifyResult {
  syntaxOk: boolean;
  /** When `syntaxOk` is false, where the parser first choked — for the "Parser failed at line N" gate. */
  syntaxError?: SyntaxError;
  /** The formatter gate outcome, computed in the worker against the overlay copy. */
  formatter?: FormatterGateResult;
  findings: Finding[];
  /**
   * The baseline, analyzed by the worker from the UNPATCHED content in this same overlay.
   *
   * Optional because the worker can only compute it when the caller supplied `originalSource`, and
   * because an older worker build does not send it at all. Absent means "use your own baseline".
   */
  baselineFindings?: Finding[];
  aborted: boolean;
}

export interface VerifyJob {
  id: string;
  /** The overlay root (a copy of the workspace with the patch applied) — never the real workspace. */
  overlayRoot: string;
  target: AnalysisTargetRef;
  /**
   * The file's content BEFORE the patch, so the parser gate can ask "did this patch break it?"
   * rather than "does it parse?".
   *
   * Those are different questions whenever the grammar is older than the language: tree-sitter-css
   * cannot parse `0%, 100% { … }` in a `@keyframes`, or `:where(select:is([multiple]))`, both of
   * which are valid CSS in wide use. Judged absolutely, every repair in such a file is rejected for
   * a defect on a line it never touched. Judged differentially, only syntax the patch actually
   * introduced counts — which is what the gate exists to catch, and is not a weakening of it.
   */
  originalSource?: string;
  timeoutMs?: number;
  onResult: (result: VerifyResult) => void;
  onError: (message: string) => void;
}

/**
 * Proceed Mode scope selection (P2.2R). The AST is only available in the worker (tree-sitter is
 * ESM + WASM), so main asks it for the smallest enclosing scope instead of parsing anything itself.
 */
export interface ResolveScopeJob {
  id: string;
  source: string;
  language: Language;
  filePath: string;
  selectionStartLine: number;
  selectionEndLine?: number;
  timeoutMs?: number;
  onResult: (scope: EditScope) => void;
  onError: (message: string) => void;
}

/**
 * Deterministic micro-repair (Q2 Fix #2A). A tool-authored autofix (ESLint's `fix`, Ruff's edits) is
 * applied and re-parsed here, in the worker, because `deterministicRepair` — like `resolveEditScope`
 * before it — depends on the ESM + tree-sitter-WASM engine that cannot load in Electron's CJS main
 * process (confirmed by a real build: `require("@fixora/core-analysis")` in main throws
 * `ERR_REQUIRE_ESM`). Main never re-implements the fix; it only asks the worker to run the SAME
 * `deterministicRepair` the engine already ships.
 */
export interface MicroRepairJob {
  id: string;
  finding: Finding;
  source: string;
  language: Language;
  filePath: string;
  timeoutMs?: number;
  onResult: (result: MicroRepairResult | null) => void;
  onError: (message: string) => void;
}

type ActiveJob =
  | {
      kind: 'analyze';
      id: string;
      timer: NodeJS.Timeout;
      onFileFindings: AnalysisJob['onFileFindings'];
      onDone: AnalysisJob['onDone'];
      onError: AnalysisJob['onError'];
    }
  | {
      kind: 'verify';
      id: string;
      timer: NodeJS.Timeout;
      onResult: VerifyJob['onResult'];
      onError: VerifyJob['onError'];
    }
  | {
      kind: 'resolveScope';
      id: string;
      timer: NodeJS.Timeout;
      onResult: ResolveScopeJob['onResult'];
      onError: ResolveScopeJob['onError'];
    }
  | {
      kind: 'microRepair';
      id: string;
      timer: NodeJS.Timeout;
      onResult: MicroRepairJob['onResult'];
      onError: MicroRepairJob['onError'];
    };

/**
 * Full-workspace analysis. 180s was tuned for a mid-size repo; a large monorepo (tens of thousands
 * of files, eslint/tsc/mypy each walking the whole tree) legitimately takes longer than that to
 * finish a clean run, and a timeout mid-run reports "Analysis timed out" for work that was still
 * making progress. Raised 5x — cancellation (below) is still the fast path for a run the user
 * actually wants to stop.
 */
const DEFAULT_TIMEOUT_MS = 900_000;
/** Verification overlays and re-checks ONE file — unrelated to workspace size, so it keeps the
 * original budget rather than inheriting the full-run timeout above. */
const VERIFY_TIMEOUT_MS = 180_000;
/** Scope selection is one parse of one file — seconds, not minutes. A stall here must not hang the UI. */
const SCOPE_TIMEOUT_MS = 30_000;
/** A micro-repair is one edit-apply + one re-parse of a single file — same order of cost as scope selection. */
const MICRO_REPAIR_TIMEOUT_MS = 30_000;

/** A message from the worker — validated structurally before use (it crosses a process boundary). */
type WorkerMessage =
  | { type: 'fileFindings'; jobId: string; file: string; findings: Finding[] }
  | { type: 'done'; jobId: string; aborted: boolean }
  | {
      type: 'verifyResult';
      jobId: string;
      syntaxOk: boolean;
      syntaxError?: SyntaxError;
      formatter?: FormatterGateResult;
      findings: Finding[];
      baselineFindings?: Finding[];
      aborted: boolean;
    }
  | { type: 'scopeResult'; jobId: string; scope: EditScope }
  | { type: 'microRepairResult'; jobId: string; result: MicroRepairResult | null }
  | { type: 'error'; jobId: string; message: string };

/** `null` means "no autofix could be applied cleanly" — a valid, expected outcome, not a shape error. */
function asMicroRepairResult(value: unknown): MicroRepairResult | null {
  if (value === null || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  if (typeof r['patched'] !== 'string' || typeof r['parseOk'] !== 'boolean') return null;
  if (typeof r['source'] !== 'string' || !Array.isArray(r['edits'])) return null;
  const edits = r['edits'].filter(
    (e): e is { range: [number, number]; text: string } =>
      typeof e === 'object' &&
      e !== null &&
      Array.isArray((e as Record<string, unknown>)['range']) &&
      typeof (e as Record<string, unknown>)['text'] === 'string',
  );
  return {
    patched: r['patched'],
    parseOk: r['parseOk'],
    source: r['source'] as MicroRepairResult['source'],
    edits,
  };
}

function asWorkerMessage(value: unknown): WorkerMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const m = value as Record<string, unknown>;
  if (
    m['type'] === 'fileFindings' &&
    typeof m['file'] === 'string' &&
    Array.isArray(m['findings'])
  ) {
    return {
      type: 'fileFindings',
      jobId: String(m['jobId']),
      file: m['file'],
      findings: m['findings'] as Finding[],
    };
  }
  if (m['type'] === 'verifyResult' && Array.isArray(m['findings'])) {
    const se = m['syntaxError'];
    let syntaxError: SyntaxError | undefined;
    if (typeof se === 'object' && se !== null) {
      const rec = se as Record<string, unknown>;
      const text = rec['text'];
      syntaxError = {
        line: Number(rec['line']) || 1,
        column: Number(rec['column']) || 1,
        text: typeof text === 'string' ? text : 'Syntax error',
      };
    }
    const fm = m['formatter'];
    let formatter: FormatterGateResult | undefined;
    if (typeof fm === 'object' && fm !== null) {
      const rec = fm as Record<string, unknown>;
      const name = rec['formatter'];
      const msg = rec['message'];
      formatter = {
        ran: rec['ran'] === true,
        ok: rec['ok'] === true,
        ...(typeof name === 'string' ? { formatter: name } : {}),
        ...(typeof msg === 'string' ? { message: msg } : {}),
      };
    }
    return {
      type: 'verifyResult',
      jobId: String(m['jobId']),
      syntaxOk: m['syntaxOk'] === true,
      ...(syntaxError !== undefined ? { syntaxError } : {}),
      ...(formatter !== undefined ? { formatter } : {}),
      findings: m['findings'] as Finding[],
      // Forwarded only when the worker sent it. This normalizer drops any field it does not name, so
      // a new worker field is invisible to main until it is listed here — which is exactly how the
      // same-environment baseline silently failed to arrive the first time.
      ...(Array.isArray(m['baselineFindings'])
        ? { baselineFindings: m['baselineFindings'] as Finding[] }
        : {}),
      aborted: m['aborted'] === true,
    };
  }
  if (m['type'] === 'scopeResult' && typeof m['scope'] === 'object' && m['scope'] !== null) {
    const s = m['scope'] as Record<string, unknown>;
    const name = s['symbolName'];
    const basis = s['basis'];
    return {
      type: 'scopeResult',
      jobId: String(m['jobId']),
      scope: {
        symbolName: typeof name === 'string' ? name : null,
        startLine: Number(s['startLine']) || 1,
        endLine: Number(s['endLine']) || 1,
        text: typeof s['text'] === 'string' ? s['text'] : '',
        basis:
          basis === 'enclosing-symbol' || basis === 'nearest-symbol' ? basis : 'selection-fallback',
      },
    };
  }
  if (m['type'] === 'microRepairResult') {
    return {
      type: 'microRepairResult',
      jobId: String(m['jobId']),
      result: asMicroRepairResult(m['result']),
    };
  }
  if (m['type'] === 'done')
    return { type: 'done', jobId: String(m['jobId']), aborted: m['aborted'] === true };
  if (m['type'] === 'error')
    return { type: 'error', jobId: String(m['jobId']), message: String(m['message']) };
  return null;
}

export interface AnalysisHost {
  run(job: AnalysisJob): void;
  verify(job: VerifyJob): void;
  /** Proceed Mode: ask the worker for the smallest enclosing edit scope (tree-sitter lives there). */
  resolveScope(job: ResolveScopeJob): void;
  /** Q2 Fix #2A: apply a tool-authored autofix in the worker, where `deterministicRepair` lives. */
  microRepair(job: MicroRepairJob): void;
  cancel(): void;
  dispose(): void;
}

export function createAnalysisHost(workerPath: string): AnalysisHost {
  let worker: UtilityProcess | null = null;
  let active: ActiveJob | null = null;

  function finish(job: ActiveJob): void {
    clearTimeout(job.timer);
    if (active?.id === job.id) active = null;
  }

  function handleMessage(raw: unknown): void {
    const message = asWorkerMessage(raw);
    if (message === null || active === null) return;
    const job = active;
    if (message.jobId !== job.id) return;
    if (message.type === 'error') {
      finish(job);
      job.onError(message.message);
      return;
    }
    if (job.kind === 'analyze') {
      if (message.type === 'fileFindings') {
        job.onFileFindings(message.file, message.findings);
      } else if (message.type === 'done') {
        finish(job);
        job.onDone(message.aborted);
      }
      return;
    }
    if (job.kind === 'resolveScope') {
      if (message.type === 'scopeResult') {
        finish(job);
        job.onResult(message.scope);
      }
      return;
    }
    if (job.kind === 'microRepair') {
      if (message.type === 'microRepairResult') {
        finish(job);
        job.onResult(message.result);
      }
      return;
    }
    // verify job
    if (message.type === 'verifyResult') {
      finish(job);
      /**
       * Every optional field the worker sent must be forwarded here.
       *
       * This object used to list only `syntaxOk`, `findings` and `aborted`, silently discarding the
       * rest of the message — so three things the worker computed correctly never reached the verdict:
       * `syntaxError` (the parser gate degraded to "does not parse" instead of naming the line),
       * `formatter` (the badge always read "not run", even when the gate had run and passed), and
       * `baselineFindings` (the same-environment baseline, which is the whole Q8 fix).
       *
       * It is a trap: adding a field to the worker and to `asWorkerMessage` looks complete and
       * changes nothing, because the loss happens one layer further in. Anything added to
       * `VerifyResult` has to be added here too.
       */
      job.onResult({
        syntaxOk: message.syntaxOk,
        findings: message.findings,
        ...(message.syntaxError !== undefined ? { syntaxError: message.syntaxError } : {}),
        ...(message.formatter !== undefined ? { formatter: message.formatter } : {}),
        ...(message.baselineFindings !== undefined
          ? { baselineFindings: message.baselineFindings }
          : {}),
        aborted: message.aborted,
      });
    }
  }

  function ensureWorker(): UtilityProcess {
    if (worker !== null) return worker;
    const child = utilityProcess.fork(workerPath, [], {
      serviceName: 'fixora-analysis',
      stdio: 'ignore',
    });
    child.on('message', handleMessage);
    child.on('exit', () => {
      worker = null;
      if (active !== null) {
        const job = active;
        finish(job);
        job.onError('The analysis worker exited unexpectedly.');
      }
    });
    worker = child;
    return child;
  }

  /** Hard-stop the worker (a wedged tool that ignores cancel) and force a fresh one next run. */
  function kill(): void {
    worker?.kill();
    worker = null;
  }

  return {
    run(job: AnalysisJob): void {
      this.cancel(); // one job at a time — a new run supersedes the old
      const child = ensureWorker();
      const timer = setTimeout(() => {
        const stalled = active;
        kill();
        if (stalled !== null) {
          active = null;
          stalled.onError('Analysis timed out.');
        }
      }, job.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      active = {
        kind: 'analyze',
        id: job.id,
        timer,
        onFileFindings: job.onFileFindings,
        onDone: job.onDone,
        onError: job.onError,
      };
      child.postMessage({
        type: 'analyze',
        jobId: job.id,
        workspaceRoot: job.workspaceRoot,
        targets: job.targets,
      });
    },

    verify(job: VerifyJob): void {
      this.cancel();
      const child = ensureWorker();
      const timer = setTimeout(() => {
        const stalled = active;
        kill();
        if (stalled !== null) {
          active = null;
          stalled.onError('Verification timed out.');
        }
      }, job.timeoutMs ?? VERIFY_TIMEOUT_MS);
      active = { kind: 'verify', id: job.id, timer, onResult: job.onResult, onError: job.onError };
      child.postMessage({
        type: 'verify',
        jobId: job.id,
        workspaceRoot: job.overlayRoot,
        target: job.target,
        ...(job.originalSource === undefined ? {} : { originalSource: job.originalSource }),
      });
    },

    resolveScope(job: ResolveScopeJob): void {
      this.cancel();
      const child = ensureWorker();
      const timer = setTimeout(() => {
        const stalled = active;
        kill();
        if (stalled !== null) {
          active = null;
          stalled.onError('Scope selection timed out.');
        }
      }, job.timeoutMs ?? SCOPE_TIMEOUT_MS);
      active = {
        kind: 'resolveScope',
        id: job.id,
        timer,
        onResult: job.onResult,
        onError: job.onError,
      };
      child.postMessage({
        type: 'resolveScope',
        jobId: job.id,
        source: job.source,
        language: job.language,
        filePath: job.filePath,
        selectionStartLine: job.selectionStartLine,
        ...(job.selectionEndLine !== undefined ? { selectionEndLine: job.selectionEndLine } : {}),
      });
    },

    microRepair(job: MicroRepairJob): void {
      this.cancel();
      const child = ensureWorker();
      const timer = setTimeout(() => {
        const stalled = active;
        kill();
        if (stalled !== null) {
          active = null;
          stalled.onError('Deterministic repair timed out.');
        }
      }, job.timeoutMs ?? MICRO_REPAIR_TIMEOUT_MS);
      active = {
        kind: 'microRepair',
        id: job.id,
        timer,
        onResult: job.onResult,
        onError: job.onError,
      };
      child.postMessage({
        type: 'microRepair',
        jobId: job.id,
        finding: job.finding,
        source: job.source,
        language: job.language,
        filePath: job.filePath,
      });
    },

    cancel(): void {
      if (active === null) return;
      const job = active;
      finish(job);
      worker?.postMessage({ type: 'cancel', jobId: job.id });
    },

    dispose(): void {
      if (active !== null) clearTimeout(active.timer);
      active = null;
      kill();
    },
  };
}
