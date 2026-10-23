import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { gitBlame } from '../electron/main/services/git-blame-service.js';
import {
  createReadOnlyGitEnv,
  readOnlyGitArgs,
  runGitProcess,
} from '../electron/main/services/git-process.js';
import { gitBranches, gitCheckout, gitCommit, gitDiff, gitStatus } from '../electron/main/services/git-service.js';

const roots: string[] = [];

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'fixora-git-security-'));
  roots.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Fixora Test');
  git(root, 'config', 'user.email', 'fixora-test@example.invalid');
  writeFileSync(join(root, 'sample.txt'), 'original\n');
  git(root, 'add', '--', 'sample.txt');
  git(root, 'commit', '-m', 'initial');
  return root;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function markerScript(root: string, name: string): { marker: string; command: string } {
  const marker = join(root, `${name}.marker`);
  const helper = join(root, `${name}.cjs`);
  writeFileSync(helper, "require('node:fs').writeFileSync(process.argv[2], 'executed');\n");
  return { marker, command: `node "${helper}" "${marker}"` };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('automatic Git subprocess hardening', () => {
  it('status overrides a malicious repository core.fsmonitor helper', async () => {
    const root = makeRepo();
    const { marker, command } = markerScript(root, 'fsmonitor');
    git(root, 'config', 'core.fsmonitor', command);

    const status = await gitStatus(root);

    expect(status.branch).not.toBeNull();
    expect(existsSync(marker)).toBe(false);
  }, 20_000);

  it('uses the built-in status subcommand instead of a repository alias', async () => {
    const root = makeRepo();
    const { marker, command } = markerScript(root, 'status-alias');
    git(root, 'config', 'alias.status', `!${command}`);

    const status = await gitStatus(root);

    expect(status.branch).not.toBeNull();
    expect(existsSync(marker)).toBe(false);
  }, 20_000);

  it('diff and blame do not invoke external diff or textconv helpers', async () => {
    const root = makeRepo();
    const external = markerScript(root, 'external-diff');
    const textconv = markerScript(root, 'textconv');
    git(root, 'config', 'diff.external', external.command);
    git(root, 'config', 'diff.malicious.textconv', textconv.command);
    writeFileSync(join(root, '.gitattributes'), 'sample.txt diff=malicious\n');

    const diff = await gitDiff(root, 'sample.txt');
    const blame = await gitBlame(root, 'sample.txt');

    expect(diff.original).toBe('original\n');
    expect(blame).toHaveLength(1);
    expect(existsSync(external.marker)).toBe(false);
    expect(existsSync(textconv.marker)).toBe(false);
  }, 20_000);

  it('does not launch configured pagers while listing branches', async () => {
    const root = makeRepo();
    const { marker, command } = markerScript(root, 'pager');
    git(root, 'config', 'core.pager', command);

    const result = await gitBranches(root);

    expect(result.current).not.toBe('');
    expect(existsSync(marker)).toBe(false);
  }, 20_000);

  it('disables askpass, terminal prompts and inherited helper variables', () => {
    const env = createReadOnlyGitEnv();

    expect(env['GIT_TERMINAL_PROMPT']).toBe('0');
    expect(env['GIT_ASKPASS']).toBe('');
    expect(env['SSH_ASKPASS']).toBe('');
    expect(env['GIT_EXTERNAL_DIFF']).toBe('');
    expect(env['GIT_PAGER']).toBe('cat');
    expect(env['PAGER']).toBe('cat');
    expect(env['GIT_CONFIG_KEY_0']).toBe('core.fsmonitor');
    expect(env['GIT_CONFIG_VALUE_0']).toBe('false');
    expect(readOnlyGitArgs(['status'])).toContain('--no-pager');
  });

  it('keeps branch and path input as argv data instead of interpreting shell metacharacters', async () => {
    const root = makeRepo();
    const marker = join(root, 'injected.marker');
    const branch = 'feature;node-injection-marker';
    git(root, 'branch', branch);
    await gitCheckout(root, branch);
    const result = await gitBranches(root);

    expect(result.branches).toContain(branch);
    expect(result.current).toBe(branch);
    await expect(gitDiff(root, `sample.txt;node -e "require('node:fs').writeFileSync('${marker}', 'ran')"`)).rejects.toThrow();
    expect(existsSync(marker)).toBe(false);
  }, 20_000);

  it('bounds and kills a hung subprocess', async () => {
    const root = makeRepo();
    const started = Date.now();
    const result = await runGitProcess(
      process.execPath,
      ['-e', 'setInterval(() => undefined, 1000)'],
      { cwd: root, timeoutMs: 50 },
    );

    expect(result.code).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('retains ordinary explicit commit hook behavior', async () => {
    const root = makeRepo();
    const hooks = join(root, '.git', 'hooks');
    const marker = join(root, 'pre-commit.marker');
    mkdirSync(hooks, { recursive: true });
    const hook = join(hooks, 'pre-commit');
    writeFileSync(
      hook,
      `#!/bin/sh\nnode -e 'require("node:fs").writeFileSync(process.argv[1], "hook")' "${marker}"\n`,
    );
    writeFileSync(join(root, 'sample.txt'), 'updated\n');
    git(root, 'add', '--', 'sample.txt');

    await gitCommit(root, 'explicit commit');

    expect(readFileSync(marker, 'utf8')).toBe('hook');
  }, 20_000);
});
