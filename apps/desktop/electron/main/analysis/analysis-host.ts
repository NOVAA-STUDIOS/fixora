import type { Finding } from '@fixora/shared-types';
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
  aborted: boolean;
}

export interface VerifyJob {
  id: string;
  /** The overlay root (a copy of the workspace with the patch applied) — never the real workspace. */
  overlayRoot: string;
  target: AnalysisTargetRef;
  timeoutMs?: number;
  onResult: (result: VerifyResult) => void;
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
    };

const DEFAULT_TIMEOUT_MS = 180_000;

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
      aborted: boolean;
    }
  | { type: 'error'; jobId: string; message: string };

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
      aborted: m['aborted'] === true,
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
    // verify job
    if (message.type === 'verifyResult') {
      finish(job);
      job.onResult({
        syntaxOk: message.syntaxOk,
        findings: message.findings,
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
      }, job.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      active = { kind: 'verify', id: job.id, timer, onResult: job.onResult, onError: job.onError };
      child.postMessage({
        type: 'verify',
        jobId: job.id,
        workspaceRoot: job.overlayRoot,
        target: job.target,
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
