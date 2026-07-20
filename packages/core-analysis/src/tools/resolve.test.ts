import { describe, expect, it, vi } from 'vitest';

import { runTool } from '../process/run-tool.js';

import { resolveBundledNodeTool, resolveNodeTool } from './resolve.js';

/**
 * The Electron/Node execPath trap.
 *
 * A resolved Node tool runs as `process.execPath <bin.js>`. That is correct when the host is Node
 * and wrong when the host is Electron, where `process.execPath` is `electron.exe` — spawning it
 * boots an Electron app instead of a Node process. The script still runs and still writes correct
 * output, but the Electron event loop never ends, so the child hangs until the runner's 30s SIGKILL.
 *
 * The symptom was not an error. Analysis returned the RIGHT finding ~31s late, so anything that gave
 * up sooner (a poll, a user) saw "no findings" from a working analyzer. These pin the flag that
 * prevents it, and the merge behaviour that keeps the child runnable at all.
 */
describe('resolveNodeTool — Electron execPath', () => {
  it('asks for Node mode when the host is Electron', () => {
    // process.versions.electron is absent under vitest, so it is faked to reach the Electron branch.
    vi.stubGlobal('process', {
      ...process,
      versions: { ...process.versions, electron: '38.0.0' },
    });
    try {
      const tool = resolveBundledNodeTool('eslint');
      expect(tool, 'bundled eslint should resolve').not.toBeNull();
      // THE REGRESSION: without this the child never exits and analysis is 30s late.
      expect(tool?.env?.['ELECTRON_RUN_AS_NODE']).toBe('1');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sets no env when the host is plain Node, so nothing changes off Electron', () => {
    expect(process.versions['electron']).toBeUndefined();
    expect(resolveBundledNodeTool('eslint')?.env).toBeUndefined();
  });

  it('returns null for a package that is not installed', () => {
    expect(resolveNodeTool(process.cwd(), 'definitely-not-a-real-package-xyz')).toBeNull();
  });
});

describe('runTool — env merging', () => {
  const signal = new AbortController().signal;

  it('merges over the parent env rather than replacing it', async () => {
    // Replacing would strip PATH/SystemRoot and the child would not run at all on Windows.
    const run = await runTool({
      command: process.execPath,
      args: [
        '-e',
        'process.stdout.write(JSON.stringify({m:process.env.FIXORA_MARKER??null,p:process.env.PATH!==undefined}))',
      ],
      cwd: process.cwd(),
      env: { FIXORA_MARKER: 'set-by-test' },
      signal,
    });
    const out = JSON.parse(run.stdout) as { m: string | null; p: boolean };
    expect(out.m).toBe('set-by-test');
    expect(out.p, 'PATH must survive the merge').toBe(true);
  });

  it('leaves the environment alone when no env is supplied', async () => {
    const run = await runTool({
      command: process.execPath,
      args: ['-e', 'process.stdout.write(process.env.PATH===undefined?"NOPATH":"HASPATH")'],
      cwd: process.cwd(),
      signal,
    });
    expect(run.stdout).toBe('HASPATH');
  });

  it('a Node tool actually exits on its own, well inside the timeout', async () => {
    // The bug in one assertion: the child must terminate by itself, not be killed.
    const tool = resolveBundledNodeTool('eslint');
    expect(tool).not.toBeNull();
    const run = await runTool({
      command: tool!.command,
      args: [...tool!.args, '--version'],
      env: tool!.env,
      cwd: process.cwd(),
      signal,
      timeoutMs: 20_000,
    });
    expect(run.killed, 'the tool must exit on its own, never be SIGKILLed').toBe(false);
    expect(run.stdout).toMatch(/^v\d+\./);
  }, 30_000);
});
