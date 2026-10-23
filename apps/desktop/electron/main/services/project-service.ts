import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve, win32 } from 'node:path';

import {
  isValidProjectName,
  PROJECT_TEMPLATES,
  UserFacingError,
  type ProjectScaffoldStep,
} from '@fixora/shared-types';

const OUTPUT_TAIL_BYTES = 4000;
const CREATE_TIMEOUT_MS = 60_000;

function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  execFile('taskkill', ['/pid', String(pid), '/t', '/f'], () => {
    // Best-effort: the process may already have exited.
  });
}

type ProjectCommandResolution = { executable: string; prefixArgs: string[] };

type ProjectCommandOptions = {
  platform?: NodeJS.Platform;
  pathValue?: string;
  electronRuntime?: boolean;
  fileExists?: (path: string) => boolean;
};

function findOnPath(
  name: string,
  pathValue: string,
  platform: NodeJS.Platform,
  fileExists: (path: string) => boolean,
): string | null {
  const pathApi = platform === 'win32' ? win32 : posix;
  const pathDelimiter = platform === 'win32' ? ';' : ':';
  for (const entry of pathValue.split(pathDelimiter)) {
    const directory = entry.trim().replace(/^"(.*)"$/, '$1');
    if (directory === '') continue;
    const candidate = pathApi.join(directory, name);
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

/** Resolve system Node tooling, never Electron's own executable, for scaffold subprocesses. */
export function resolveProjectCommand(
  executable: string,
  options: ProjectCommandOptions = {},
): ProjectCommandResolution | null {
  const platform = options.platform ?? process.platform;
  const electronRuntime = options.electronRuntime ??
    Boolean((process.versions as NodeJS.ProcessVersions & { electron?: string }).electron);
  const fileExists = options.fileExists ?? existsSync;
  const pathValue = options.pathValue ?? process.env['PATH'] ?? '';

  if (platform === 'win32' && ['node', 'npm', 'npx'].includes(executable)) {
    const nodeOnPath = findOnPath('node.exe', pathValue, platform, fileExists);
    const nodeExecutable = electronRuntime ? nodeOnPath : (nodeOnPath ?? process.execPath);
    if (nodeExecutable === null) return null;
    if (executable === 'node') return { executable: nodeExecutable, prefixArgs: [] };

    // npm.cmd/npx.cmd require a shell on Windows. Invoke their shipped JS entry points with the
    // system Node executable instead; Electron's process.execPath is Fixora.exe when packaged.
    const cli = win32.join(
      win32.dirname(nodeExecutable),
      'node_modules',
      'npm',
      'bin',
      executable === 'npm' ? 'npm-cli.js' : 'npx-cli.js',
    );
    return fileExists(cli) ? { executable: nodeExecutable, prefixArgs: [cli] } : null;
  }

  if (executable === 'node') {
    return electronRuntime
      ? { executable: 'node', prefixArgs: [] }
      : { executable: process.execPath, prefixArgs: [] };
  }
  return { executable, prefixArgs: [] };
}

async function checkNodeAvailable(): Promise<boolean> {
  for (const executable of ['npx', 'node', 'npm']) {
    const command = resolveProjectCommand(executable);
    if (command === null) continue;
    const found = await new Promise<boolean>((resolvePromise) => {
      execFile(
        command.executable,
        [...command.prefixArgs, '--version'],
        { timeout: 5000, windowsHide: true, shell: false },
        (error) => { resolvePromise(error === null); },
      );
    });
    if (found) return true;
  }
  return false;
}

function invalidProjectName(): UserFacingError {
  return new UserFacingError(
    'Project name must be 1–64 letters, numbers, dots, dashes, or underscores, without paths or consecutive dots.',
    { code: 'contract_violation', action: { type: 'none', label: 'Dismiss' }, stage: 'workspace' },
  );
}

async function runCommand(executable: string, args: readonly string[], cwd: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const command = resolveProjectCommand(executable);
    if (command === null) {
      reject(new UserFacingError(`Required system command ${executable} is unavailable.`, {
        code: 'contract_violation', action: { type: 'none', label: 'Dismiss' }, stage: 'workspace',
      }));
      return;
    }
    const child = spawn(command.executable, [...command.prefixArgs, ...args], {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let tail = '';
    const capture = (chunk: Buffer): void => {
      tail = (tail + chunk.toString('utf8')).slice(-OUTPUT_TAIL_BYTES);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const timer = setTimeout(() => {
      killTree(child.pid);
      reject(new UserFacingError('The scaffold command took too long and was stopped.', {
        code: 'timeout', action: { type: 'none', label: 'Dismiss' }, stage: 'workspace',
      }));
    }, CREATE_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new UserFacingError(`Could not start the scaffold command: ${error.message}`, {
        code: 'contract_violation', action: { type: 'none', label: 'Dismiss' }, stage: 'workspace',
      }));
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise();
        return;
      }
      const detail = tail.trim();
      reject(new UserFacingError(
        `The scaffold command failed (exit code ${String(code)}).${detail === '' ? '' : `\n\n${detail}`}`,
        { code: 'contract_violation', action: { type: 'none', label: 'Dismiss' }, stage: 'workspace' },
      ));
    });
  });
}

async function executeStep(step: ProjectScaffoldStep, parentDir: string, projectPath: string): Promise<void> {
  if (step.type === 'mkdir') {
    mkdirSync(projectPath);
    return;
  }
  if (step.type === 'touch') {
    for (const file of step.files) writeFileSync(join(projectPath, file), '', { flag: 'wx' });
    return;
  }
  await runCommand(step.executable, step.args, step.cwd === 'parent' ? parentDir : projectPath);
}

export async function createProject(parentDir: string, name: string, templateId: string): Promise<string> {
  if (!isValidProjectName(name)) throw invalidProjectName();
  const template = PROJECT_TEMPLATES.find((candidate) => candidate.id === templateId);
  if (template === undefined) {
    throw new UserFacingError('Unknown project template.', {
      code: 'contract_violation', action: { type: 'none', label: 'Dismiss' }, stage: 'workspace',
    });
  }
  if (!(await checkNodeAvailable())) {
    throw new UserFacingError(
      'Node.js is required to create new projects. Download it from nodejs.org, then restart Fixora to apply the changes.',
      { code: 'contract_violation', action: { type: 'none', label: 'Dismiss' }, stage: 'workspace' },
    );
  }

  const resolvedParent = resolve(parentDir);
  const projectPath = resolve(resolvedParent, name);
  if (dirname(projectPath) !== resolvedParent) throw invalidProjectName();
  if (existsSync(projectPath)) {
    throw new UserFacingError(
      'A folder with this name already exists. Please choose a different folder or project name.',
      { code: 'contract_violation', action: { type: 'none', label: 'Dismiss' }, stage: 'workspace' },
    );
  }

  for (const step of template.steps(name)) await executeStep(step, resolvedParent, projectPath);
  return projectPath;
}
