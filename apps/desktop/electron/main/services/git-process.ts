import { execFile, execFileSync } from 'node:child_process';

export type GitProcessResult = { code: number; stdout: string; stderr: string };

const READ_ONLY_CONFIG: readonly string[] = [
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.pager=cat',
  '-c',
  'diff.external=',
];

/**
 * Build a hardened environment for automatic/read-only Git calls. PATH and the rest of the host
 * environment are retained so the expected Git installation still resolves, but helper/prompt
 * variables and config-injection variables are replaced. Explicit mutating actions intentionally
 * do not use this environment so normal user hooks and credential helpers keep working.
 */
export function createReadOnlyGitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    PAGER: 'cat',
    GIT_EXTERNAL_DIFF: '',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    GIT_SSH: '',
    GIT_SSH_COMMAND: '',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_PARAMETERS: '',
    GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_0: 'core.fsmonitor',
    GIT_CONFIG_VALUE_0: 'false',
    GIT_CONFIG_KEY_1: 'core.pager',
    GIT_CONFIG_VALUE_1: 'cat',
    GIT_CONFIG_KEY_2: 'diff.external',
    GIT_CONFIG_VALUE_2: '',
  };
}

export function readOnlyGitArgs(args: readonly string[]): string[] {
  return ['--no-pager', ...READ_ONLY_CONFIG, ...args];
}

/** Shared bounded Git process runner. `execFile` receives argv directly and never invokes a shell. */
export function runGitProcess(
  executable: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs: number; readOnly?: boolean },
): Promise<GitProcessResult> {
  return new Promise((resolve) => {
    execFile(
      executable,
      [...args],
      {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: 16 * 1024 * 1024,
        shell: false,
        windowsHide: true,
        ...(options.readOnly === true ? { env: createReadOnlyGitEnv() } : {}),
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        resolve({ code: typeof error.code === 'number' ? error.code : 1, stdout, stderr });
      },
    );
  });
}
/** Synchronous counterpart for build metadata only; still argv-only and helper-hardened. */
export function runReadOnlyGitSync(
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): string {
  return execFileSync('git', readOnlyGitArgs(args), {
    cwd,
    env: createReadOnlyGitEnv(),
    encoding: 'utf8',
    shell: false,
    timeout: timeoutMs,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}
