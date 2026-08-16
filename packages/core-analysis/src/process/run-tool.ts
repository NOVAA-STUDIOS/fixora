import { spawn } from 'node:child_process';

/**
 * Running an external tool is running *hostile-shaped work*: a linter can hang, a type-checker can
 * take minutes on a huge project, a rule can backtrack forever. So every invocation has a hard
 * timeout and honours an `AbortSignal` — the analyzer host (M3 §4) runs this inside a utility process
 * it can also kill, but defence in depth starts here: one runaway tool must not wedge the engine.
 *
 * The runner is an injectable seam (`ToolRunner`): adapters take it as a dependency so their
 * output-normalisation logic is unit-tested with canned tool output, and the real subprocess is
 * exercised in the acceptance run against real repos.
 */

export interface ToolRun {
  stdout: string;
  stderr: string;
  /** Exit code, or null if the process was killed (timeout/abort). */
  code: number | null;
  /** True if we killed it (for exceeding the timeout or on abort). */
  killed: boolean;
  /**
   * True when the kill was the timeout ceiling, not a user abort. Distinguishing the two is what
   * turns a silently-killed tool into a *reported* one: an abort is a normal cancellation and must
   * stay quiet, while a timeout is a reliability event that the adapters surface instead of
   * returning a misleading "zero findings".
   */
  timedOut: boolean;
  /** The effective ceiling this run used (echoed so the notice can name the real timeout). */
  timeoutMs: number;
}

export interface RunToolOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  /** Fed to the tool's stdin then closed (e.g. `eslint --stdin`). */
  input?: string;
  /** Extra environment merged over the parent's, from `ResolvedTool.env`. */
  env?: Readonly<Record<string, string>> | undefined;
  signal: AbortSignal;
  /** Hard ceiling; the process is killed past it. Default 30s. */
  timeoutMs?: number;
}

export type ToolRunner = (options: RunToolOptions) => Promise<ToolRun>;

const DEFAULT_TIMEOUT_MS = 30_000;

export const runTool: ToolRunner = (options) => {
  const { command, args, cwd, input, env, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  return new Promise<ToolRun>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted before start', 'AbortError'));
      return;
    }

    const child = spawn(command, [...args], {
      cwd,
      // Merged, not replaced: a tool still needs PATH, SystemRoot, HOME and the rest to run at all.
      ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
      // Never a shell: arguments are passed as an array so nothing in a path or filename is ever
      // interpreted by a shell (command-injection defence — the workspace is not fully trusted input).
      shell: false,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let killed = false;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      killed = true;
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    const onAbort = (): void => {
      // A user abort stays `timedOut: false`: cancellation is not a reliability failure, and the
      // adapters must not surface a "tool timed out" warning for a run the user cancelled.
      killed = true;
      child.kill('SIGKILL');
    };
    signal.addEventListener('abort', onAbort, { once: true });

    const cleanup = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ stdout, stderr, code, killed, timedOut, timeoutMs });
    });

    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
};
