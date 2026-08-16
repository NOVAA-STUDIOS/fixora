import { describe, expect, it } from 'vitest';

import { runTool } from './run-tool.js';

/**
 * NOV7-01 regression: the runner's timeout must be distinguishable from a user abort.
 *
 * The bug this guards: `runTool` killed a tool past its ceiling with exactly the same `ToolRun` as
 * an abort (`code: null, killed: true`), so every adapter treated a timed-out linter/type-checker as
 * "tool found nothing" and the analysis silently reported zero findings. `timedOut` breaks that
 * ambiguity — and the abort path must keep it `false` so cancellation stays quiet.
 */

/** Sleep for the given ms, then exit 0 — used as a controllable "slow tool". */
function slowCommand(ms: number): { command: string; args: string[] } {
  const sleep = String(ms);
  if (process.platform === 'win32') {
    return { command: 'powershell', args: ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds ' + sleep] };
  }
  return { command: 'node', args: ['-e', `setTimeout(() => {}, ${sleep})`] };
}

describe('runTool timeout vs abort', () => {
  it('marks a tool killed past the ceiling as timedOut (killed, code null)', async () => {
    const run = await runTool({
      command: slowCommand(5_000).command,
      args: slowCommand(5_000).args,
      cwd: process.cwd(),
      signal: new AbortController().signal,
      timeoutMs: 200,
    });
    expect(run.killed).toBe(true);
    expect(run.timedOut).toBe(true);
    expect(run.code).toBeNull();
    expect(run.timeoutMs).toBe(200);
  }, 10_000);

  it('a user abort is killed but NOT timedOut', async () => {
    const controller = new AbortController();
    const promise = runTool({
      command: slowCommand(5_000).command,
      args: slowCommand(5_000).args,
      cwd: process.cwd(),
      signal: controller.signal,
      timeoutMs: 10_000,
    });
    setTimeout(() => {
      controller.abort();
    }, 150);
    const run = await promise;
    expect(run.killed).toBe(true);
    expect(run.timedOut).toBe(false);
    expect(run.code).toBeNull();
  }, 10_000);

  it('a normal exit is neither killed nor timedOut', async () => {
    const run = await runTool({
      command: process.platform === 'win32' ? 'cmd' : 'node',
      args: process.platform === 'win32' ? ['/c', 'exit 0'] : ['-e', ''],
      cwd: process.cwd(),
      signal: new AbortController().signal,
      timeoutMs: 10_000,
    });
    expect(run.killed).toBe(false);
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
  }, 10_000);
});
