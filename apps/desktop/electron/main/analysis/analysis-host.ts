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
  capabilities: { tools: string[]; versions: [string, string][] };
  targets: AnalysisTargetRef[];
  timeoutMs?: number;
  onFileFindings: (file: string, findings: Finding[]) => void;
  onDone: (aborted: boolean) => void;
  onError: (message: string) => void;
}

interface ActiveJob {
  id: string;
  timer: NodeJS.Timeout;
  onFileFindings: AnalysisJob['onFileFindings'];
  onDone: AnalysisJob['onDone'];
  onError: AnalysisJob['onError'];
}

const DEFAULT_TIMEOUT_MS = 180_000;

/** A message from the worker — validated structurally before use (it crosses a process boundary). */
type WorkerMessage =
  | { type: 'fileFindings'; jobId: string; file: string; findings: Finding[] }
  | { type: 'done'; jobId: string; aborted: boolean }
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
  if (m['type'] === 'done')
    return { type: 'done', jobId: String(m['jobId']), aborted: m['aborted'] === true };
  if (m['type'] === 'error')
    return { type: 'error', jobId: String(m['jobId']), message: String(m['message']) };
  return null;
}

export interface AnalysisHost {
  run(job: AnalysisJob): void;
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
    if (message.type === 'fileFindings') {
      job.onFileFindings(message.file, message.findings);
    } else if (message.type === 'done') {
      finish(job);
      job.onDone(message.aborted);
    } else {
      finish(job);
      job.onError(message.message);
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
        capabilities: job.capabilities,
        targets: job.targets,
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
