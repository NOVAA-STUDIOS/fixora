import { describe, expect, it } from 'vitest';

import type { ToolRun } from '../process/run-tool.js';

import { formatGate, resolveFormatter } from './format-gate.js';

/**
 * The formatter gate. Resolution is language-aware (Python always has one via vendored Ruff; JS/TS use
 * the workspace's Prettier or none); execution turns a formatter's exit code into a pass/fail with its
 * own diagnostic. The runner is injected so we assert behaviour without spawning a real formatter.
 */

const ok: ToolRun = { stdout: '', stderr: '', code: 0, killed: false, timedOut: false, timeoutMs: 30_000 };

const fail = (stderr: string): ToolRun => ({
  stdout: '',
  stderr,
  code: 2,
  killed: false,
  timedOut: false,
  timeoutMs: 30_000,
});

describe('resolveFormatter', () => {
  it('always resolves a formatter for Python (Ruff is vendored)', () => {
    const f = resolveFormatter('python', '/ws', {
      bundled: () => ({ command: 'ruff', args: [] }),
      path: () => null,
    });
    expect(f?.name).toBe('ruff format');
    expect(f?.args('/ws/a.py')).toEqual(['format', '/ws/a.py']);
  });

  it('resolves Prettier for TS only when the workspace has it', () => {
    expect(resolveFormatter('typescript', '/ws', { node: () => null })).toBeNull();
    const withPrettier = resolveFormatter('typescript', '/ws', {
      node: () => ({ command: 'node', args: ['prettier'] }),
    });
    expect(withPrettier?.name).toBe('prettier');
    expect(withPrettier?.args('/ws/a.ts')).toEqual(['--write', '/ws/a.ts']);
  });
});

describe('formatGate', () => {
  it('passes when the formatter exits 0', async () => {
    const r = await formatGate({
      root: '/ws',
      absFile: '/ws/a.py',
      language: 'python',
      runner: () => Promise.resolve(ok),
      resolve: () => ({
        name: 'ruff format',
        tool: { command: 'ruff', args: [] },
        args: (f) => [f],
      }),
    });
    expect(r).toEqual({ ran: true, ok: true, formatter: 'ruff format' });
  });

  it('fails with the formatter’s own message when it exits non-zero', async () => {
    const r = await formatGate({
      root: '/ws',
      absFile: '/ws/a.py',
      language: 'python',
      runner: () => Promise.resolve(fail('error: expected an expression at line 3, column 5')),
      resolve: () => ({
        name: 'ruff format',
        tool: { command: 'ruff', args: [] },
        args: (f) => [f],
      }),
    });
    expect(r.ran).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('line 3');
  });

  it('does not block (ran:false, ok:true) when no formatter is available', async () => {
    const r = await formatGate({
      root: '/ws',
      absFile: '/ws/a.ts',
      language: 'typescript',
      runner: () => Promise.resolve(ok),
      resolve: () => null,
    });
    expect(r).toEqual({ ran: false, ok: true });
  });
});
