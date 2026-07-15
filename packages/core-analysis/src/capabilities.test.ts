import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectCapabilities } from './capabilities.js';
import type { ToolRun } from './process/run-tool.js';

/**
 * Capability detection is "which of the user's tools are here". We stub a workspace with eslint but
 * not typescript, and inject a runner for the `--version` probe, so detection is exercised without
 * any real tool on the machine. Presence is a filesystem/PATH fact; the version probe is best-effort.
 */

let workspace: string;

function stubNodeTool(pkg: string, bin: string): void {
  const dir = join(workspace, 'node_modules', pkg);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: pkg, bin: { [bin]: 'bin.js' } }));
  writeFileSync(join(dir, 'bin.js'), '// stub');
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'fixora-caps-'));
});
afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const versionRunner = (out: string) => (): Promise<ToolRun> =>
  Promise.resolve({ stdout: out, stderr: '', code: 0, killed: false });

describe('detectCapabilities', () => {
  it('detects a workspace node tool and records its version', async () => {
    stubNodeTool('eslint', 'eslint');
    const caps = await detectCapabilities(workspace, versionRunner('v9.14.0\n'));
    expect(caps.tools.has('eslint')).toBe(true);
    expect(caps.versions.get('eslint')).toBe('v9.14.0');
    expect(caps.root).toBe(workspace);
  });

  it('does not report a node tool the workspace has not installed', async () => {
    // No eslint, no typescript installed in this workspace.
    const caps = await detectCapabilities(workspace, versionRunner('x'));
    expect(caps.tools.has('eslint')).toBe(false);
    expect(caps.tools.has('tsc')).toBe(false);
  });

  it('still reports the tool as present when the version probe fails', async () => {
    stubNodeTool('typescript', 'tsc');
    const throwingRunner = (): Promise<ToolRun> => Promise.reject(new Error('spawn failed'));
    const caps = await detectCapabilities(workspace, throwingRunner);
    expect(caps.tools.has('tsc')).toBe(true);
    expect(caps.versions.has('tsc')).toBe(false);
  });
});
