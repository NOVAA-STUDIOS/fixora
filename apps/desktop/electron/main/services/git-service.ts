import { execFile } from 'node:child_process';

import { UserFacingError } from '@fixora/shared-types';

export type GitFileStatus = { path: string; status: string };
export type GitStatus = {
  /** Null when there is no git repository here at all — a legitimate, common state (New Project's
   * scaffolds don't run `git init`), never an error. */
  branch: string | null;
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
};

const GIT_TIMEOUT_MS = 15_000;

/**
 * Never rejects: a nonzero exit is git's own ordinary way of reporting "not a repository", "no
 * changes to commit", or a real command failure, not a Node-level fault — the two are
 * indistinguishable from execFile's callback shape without checking `.code`'s type (a string like
 * 'ENOENT' means git itself could not be spawned at all; a number is a normal exit code), so both
 * resolve here and the caller decides what a nonzero code means for that command.
 */
function runGit(root: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd: root, timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
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

/** `git status --porcelain=v1 -b`, parsed. Two-letter status codes: index (staged) column first,
 * working-tree (unstaged) column second — `??` (untracked) has no staged half. */
export async function gitStatus(root: string): Promise<GitStatus> {
  const result = await runGit(root, ['status', '--porcelain=v1', '-b']);
  if (result.code !== 0) return { branch: null, staged: [], unstaged: [] };

  const lines = result.stdout.split('\n').filter((l) => l !== '');
  let branch: string | null = null;
  const staged: GitFileStatus[] = [];
  const unstaged: GitFileStatus[] = [];

  for (const line of lines) {
    if (line.startsWith('##')) {
      // "## main...origin/main [ahead 1]" or "## HEAD (no branch)" (detached) — the branch name is
      // always the first token after "## ", up to the first space or "...".
      const rest = line.slice(3);
      branch = rest.split(/\.\.\.| /)[0] ?? null;
      continue;
    }
    const indexStatus = line[0];
    const workTreeStatus = line[1];
    const path = line.slice(3);
    if (indexStatus === undefined || workTreeStatus === undefined) continue;
    if (indexStatus === '?' && workTreeStatus === '?') {
      unstaged.push({ path, status: 'untracked' });
      continue;
    }
    if (indexStatus !== ' ') staged.push({ path, status: statusName(indexStatus) });
    if (workTreeStatus !== ' ') unstaged.push({ path, status: statusName(workTreeStatus) });
  }

  return { branch, staged, unstaged };
}

function statusName(code: string): string {
  switch (code) {
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    default:
      return 'changed';
  }
}

export async function gitStage(root: string, relPath: string): Promise<void> {
  const result = await runGit(root, ['add', '--', relPath]);
  if (result.code !== 0) {
    throw new UserFacingError(`Could not stage ${relPath}.`, {
      code: 'contract_violation',
      action: { type: 'none', label: 'Dismiss' },
      stage: 'workspace',
    });
  }
}

export async function gitUnstage(root: string, relPath: string): Promise<void> {
  const result = await runGit(root, ['restore', '--staged', '--', relPath]);
  if (result.code !== 0) {
    throw new UserFacingError(`Could not unstage ${relPath}.`, {
      code: 'contract_violation',
      action: { type: 'none', label: 'Dismiss' },
      stage: 'workspace',
    });
  }
}

export async function gitCommit(root: string, message: string): Promise<void> {
  const result = await runGit(root, ['commit', '-m', message]);
  if (result.code !== 0) {
    throw new UserFacingError(
      result.stderr.trim() === '' ? 'The commit failed.' : `The commit failed:\n\n${result.stderr.trim()}`,
      { code: 'contract_violation', action: { type: 'none', label: 'Dismiss' }, stage: 'workspace' },
    );
  }
}
