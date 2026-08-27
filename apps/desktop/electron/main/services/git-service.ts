import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { UserFacingError } from '@fixora/shared-types';

import { detectLanguage } from './fs/language.js';

export type GitFileStatus = { path: string; status: string };
export type GitStatus = {
  /** Null when there is no git repository here at all — a legitimate, common state (New Project's
   * scaffolds don't run `git init`), never an error. */
  branch: string | null;
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
};

const GIT_TIMEOUT_MS = 15_000;
/** How long a cached status is served without re-asking git — the status bar polls this on every
 * workspace change, and a repo with a slow git (huge working tree, cold FS cache, network drive)
 * must never make that feel like the UI itself hung. */
const CACHE_TTL_MS = 5_000;
/** The absolute ceiling on how long a caller waits for a FIRST-EVER status in this root: past
 * this, an empty result is returned rather than leaving the caller hanging — the real result
 * still lands in the cache for the next call once git actually finishes. */
const FIRST_CALL_TIMEOUT_MS = 3_000;

type CacheEntry = { status: GitStatus; fetchedAt: number };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<GitStatus>>();

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
 * working-tree (unstaged) column second — `??` (untracked) has no staged half.
 *
 * `--untracked-files=no` is the single biggest cost cut on a large tree: without it, git walks
 * every untracked directory looking for files to report, which is the part that scales with
 * project size rather than with how much actually changed. Trade-off, stated plainly: untracked
 * files no longer appear in `unstaged` here — this reads status for the branch/staged/modified
 * picture, not as a substitute for the file tree's own view of what's new on disk.
 */
async function fetchGitStatus(root: string): Promise<GitStatus> {
  const result = await runGit(root, ['status', '--porcelain=v1', '-b', '--untracked-files=no']);
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

/**
 * Cached, stale-while-revalidate. A fresh cache entry (< 5s old) is returned with no git call at
 * all. A stale-but-present entry is returned IMMEDIATELY — the actual UI-facing fix here, since
 * that is the case a slow git previously blocked on — while a background fetch refreshes the
 * cache for the next call. Only a root with no cached value yet ever waits on git directly, and
 * even then only up to `FIRST_CALL_TIMEOUT_MS` before falling back to an empty result; the real
 * one still lands in the cache once git finishes, for whichever call comes after.
 */
export async function gitStatus(root: string): Promise<GitStatus> {
  const cached = cache.get(root);
  const now = Date.now();

  const refresh = (): Promise<GitStatus> => {
    let pending = inFlight.get(root);
    if (pending === undefined) {
      pending = fetchGitStatus(root)
        .then((status) => {
          cache.set(root, { status, fetchedAt: Date.now() });
          return status;
        })
        .finally(() => {
          inFlight.delete(root);
        });
      inFlight.set(root, pending);
    }
    return pending;
  };

  if (cached !== undefined && now - cached.fetchedAt < CACHE_TTL_MS) return cached.status;
  if (cached !== undefined) {
    void refresh(); // stale-while-revalidate: today's answer now, tomorrow's answer in the background
    return cached.status;
  }

  // No cached value for this root at all — this is the one path that genuinely has to wait, and
  // it is capped rather than open-ended.
  const timeout = new Promise<GitStatus>((resolve) => {
    setTimeout(() => {
      resolve({ branch: null, staged: [], unstaged: [] });
    }, FIRST_CALL_TIMEOUT_MS);
  });
  return Promise.race([refresh(), timeout]);
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

/**
 * The two file contents Source Control's diff view needs — not a parsed unified diff, since
 * `DiffEditor` (the same Monaco diff surface the repair review flow uses) already computes and
 * renders the diff itself given original/modified text.
 *
 * `staged: false` (default): working tree vs HEAD — `modified` is what's on disk.
 * `staged: true`: index vs HEAD — `modified` is what's staged (`git show :0:<relPath>`), so an
 * edit made after staging does not leak into a diff that is supposed to describe the staged change.
 */
export async function gitDiff(
  root: string,
  relPath: string,
  staged = false,
): Promise<{ original: string; modified: string; language: string }> {
  // A nonzero exit here means the file does not exist at HEAD yet — untracked or newly added —
  // which is a real, expected state (not an error): `original` is simply empty.
  const originalResult = await runGit(root, ['show', `HEAD:${relPath}`]);
  const original = originalResult.code === 0 ? originalResult.stdout : '';

  let modified: string;
  if (staged) {
    const indexResult = await runGit(root, ['show', `:0:${relPath}`]);
    if (indexResult.code !== 0) {
      throw new UserFacingError(
        indexResult.stderr.trim() === ''
          ? `Could not read the staged version of ${relPath}.`
          : `Could not read the staged version of ${relPath}:\n\n${indexResult.stderr.trim()}`,
        { code: 'contract_violation', action: { type: 'none', label: 'Dismiss' }, stage: 'workspace' },
      );
    }
    modified = indexResult.stdout;
  } else {
    try {
      modified = readFileSync(join(root, relPath), 'utf8');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new UserFacingError(`Could not read ${relPath} from disk:\n\n${detail}`, {
        code: 'contract_violation',
        action: { type: 'none', label: 'Dismiss' },
        stage: 'workspace',
      });
    }
  }

  return { original, modified, language: detectLanguage(relPath) ?? 'plaintext' };
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

function throwOnFailure(result: { code: number; stderr: string }, fallback: string): void {
  if (result.code !== 0) {
    throw new UserFacingError(result.stderr.trim() === '' ? fallback : result.stderr.trim(), {
      code: 'contract_violation',
      action: { type: 'none', label: 'Dismiss' },
      stage: 'workspace',
    });
  }
}

export async function gitPush(root: string): Promise<void> {
  throwOnFailure(await runGit(root, ['push']), 'Push failed');
}

export async function gitPull(root: string): Promise<void> {
  throwOnFailure(await runGit(root, ['pull']), 'Pull failed');
}

export async function gitFetch(root: string): Promise<void> {
  throwOnFailure(await runGit(root, ['fetch']), 'Fetch failed');
}

export async function gitBranches(root: string): Promise<{ branches: string[]; current: string }> {
  const list = await runGit(root, ['branch', '-a', '--format=%(refname:short)']);
  const branches = list.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  const current = await runGit(root, ['branch', '--show-current']);
  return { branches, current: current.stdout.trim() };
}

export async function gitCheckout(root: string, branch: string): Promise<void> {
  throwOnFailure(await runGit(root, ['checkout', branch]), 'Checkout failed');
}
