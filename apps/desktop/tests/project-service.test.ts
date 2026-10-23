import type * as ChildProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isValidProjectName, PROJECT_TEMPLATES } from '@fixora/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createProject,
  resolveProjectCommand,
} from '../electron/main/services/project-service.js';

const processMocks = vi.hoisted(() => ({
  spawns: [] as { executable: string; args: string[]; options: Record<string, unknown> }[],
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  const execFile = vi.fn((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null) => void;
    queueMicrotask(() => { callback(null); });
  });
  const spawn = vi.fn((executable: string, args: string[], options: Record<string, unknown>) => {
    processMocks.spawns.push({ executable, args, options });
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.pid = 123;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => { child.emit('exit', 0); });
    return child;
  });
  return {
    ...actual,
    execFile,
    spawn,
    default: { ...actual, execFile, spawn },
  };
});

const roots: string[] = [];

afterEach(() => {
  processMocks.spawns = [];
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempParent(): string {
  const root = mkdtempSync(join(tmpdir(), 'fixora-project-'));
  roots.push(root);
  return root;
}

describe('project name validation', () => {
  it.each(['my-app', 'fixora_project', 'App123', 'my.app'])('accepts %s', (name) => {
    expect(isValidProjectName(name)).toBe(true);
  });

  it.each([
    '', '   ', '../evil', 'foo/bar', 'foo\\bar', 'app && calc', 'app; calc', 'app | calc',
    'app`calc`', 'app$(calc)', 'app\ncalc', 'app\u0000calc', '"app"', "'app'", '..', '.app',
  ])('rejects %j', (name) => {
    expect(isValidProjectName(name)).toBe(false);
  });
});

describe('shell-free project scaffolding', () => {
  it('uses system Node and npm CLI paths in a packaged Windows app', () => {
    const node = String.raw`C:\Tools\nodejs\node.exe`;
    const npmCli = String.raw`C:\Tools\nodejs\node_modules\npm\bin\npm-cli.js`;
    const npxCli = String.raw`C:\Tools\nodejs\node_modules\npm\bin\npx-cli.js`;
    const available = new Set([node, npmCli, npxCli]);
    const options = {
      platform: 'win32' as const,
      electronRuntime: true,
      pathValue: String.raw`C:\Tools\nodejs`,
      fileExists: (path: string) => available.has(path),
    };

    expect(resolveProjectCommand('node', options)).toEqual({ executable: node, prefixArgs: [] });
    expect(resolveProjectCommand('npm', options)).toEqual({ executable: node, prefixArgs: [npmCli] });
    expect(resolveProjectCommand('npx', options)).toEqual({ executable: node, prefixArgs: [npxCli] });
    expect(resolveProjectCommand('npx', { ...options, pathValue: '' })).toBeNull();
  });

  it('creates a safe blank project directly beneath its selected parent', async () => {
    const parent = tempParent();
    const projectPath = await createProject(parent, 'safe_app-1', 'blank');
    expect(projectPath).toBe(join(parent, 'safe_app-1'));
    expect(existsSync(projectPath)).toBe(true);
  });

  it('passes the project name as one argv element without shell mode', async () => {
    const parent = tempParent();
    await createProject(parent, 'my-app', 'react');
    expect(processMocks.spawns).toHaveLength(1);
    expect(processMocks.spawns[0]?.args).toEqual(expect.arrayContaining([
      '--yes', 'create-vite@latest', 'my-app', '--template', 'react-ts',
    ]));
    expect(processMocks.spawns[0]?.args.filter((arg) => arg === 'my-app')).toHaveLength(1);
    expect(processMocks.spawns[0]?.options['shell']).toBe(false);
    expect(processMocks.spawns[0]?.options['cwd']).toBe(parent);
  });

  it('rejects unsafe destinations before launching a process', async () => {
    const parent = tempParent();
    await expect(createProject(parent, '../evil', 'react')).rejects.toThrow('Project name');
    expect(processMocks.spawns).toEqual([]);
  });

  it('preserves all existing template ids and structured behavior', () => {
    expect(PROJECT_TEMPLATES.map(({ id }) => id)).toEqual([
      'blank', 'react', 'nextjs', 'node', 'python', 'vue', 'express',
    ]);
    for (const template of PROJECT_TEMPLATES) {
      expect(template.steps('sample')).not.toHaveLength(0);
    }
  });
});
