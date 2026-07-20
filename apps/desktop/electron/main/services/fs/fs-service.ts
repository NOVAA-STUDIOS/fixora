import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { UserFacingError } from '@fixora/shared-types';

import { type IgnoreMatcher } from './ignore-rules.js';
import { detectLanguage } from './language.js';
import { assertInsideWorkspace } from './path-guard.js';
import { isSecretPath } from './secrets-denylist.js';

/**
 * The path-guarded filesystem service (Repo §2, Security §3). Every method takes a **workspace-
 * relative** path and the trusted workspace root — the renderer never supplies an absolute path or
 * the root, so it cannot ask for anything outside the workspace even by lying. Every path is run
 * through `assertInsideWorkspace` before a single byte is read.
 */

export type DirEntry = {
  name: string;
  relPath: string;
  kind: 'dir' | 'file';
  language: string | null;
};

export type FileContent = {
  relPath: string;
  language: string | null;
  content: string;
};

/** Reading a file that is too large to open as text in the editor is refused with this size. */
const MAX_TEXT_BYTES = 8 * 1024 * 1024;

/**
 * List the immediate children of one directory — **not** the whole tree. The tree loads lazily,
 * one directory per expansion, which is what lets a 10,000-file repo open in under 2 seconds: we
 * read the root's children, not all 10,000 entries (roadmap M2 acceptance).
 *
 * Ignored entries (`.gitignore` + always-ignore) are omitted. Directories sort before files, each
 * group alphabetical — the order a developer expects.
 */
export function listDirectory(root: string, relPath: string, ignore: IgnoreMatcher): DirEntry[] {
  const absolute = assertInsideWorkspace(join(root, relPath), root);
  const entries = readdirSync(absolute, { withFileTypes: true });

  const result: DirEntry[] = [];
  for (const entry of entries) {
    // Do not follow symlinks when listing — resolve them only if the user opens through them,
    // where the guard re-checks. A symlink is shown as a leaf, never auto-expanded.
    const childRel =
      relPath === '' ? entry.name : posix.join(relPath.replace(/\\/g, '/'), entry.name);
    const isDir = entry.isDirectory();
    if (ignore.ignores(isDir ? `${childRel}/` : childRel)) continue;

    result.push({
      name: entry.name,
      relPath: childRel,
      kind: isDir ? 'dir' : 'file',
      language: isDir ? null : detectLanguage(entry.name),
    });
  }

  result.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}

/**
 * Read a file as text. Refused for a secret (the denylist, Security §4), for a path outside the
 * workspace (the guard), for a directory, and for a file larger than the editor's text ceiling. A
 * refusal is a thrown typed error the handler turns into a `Result`; it never returns partial or
 * placeholder content.
 */
export function readTextFile(root: string, relPath: string): FileContent {
  const normalized = relPath.replace(/\\/g, '/');
  if (isSecretPath(normalized)) {
    throw new SecretFileError(normalized);
  }

  const absolute = assertInsideWorkspace(join(root, relPath), root);
  const stat = statSync(absolute);
  if (stat.isDirectory()) {
    throw new UserFacingError('That path is a folder, not a file, so it cannot be opened.', {
      code: 'is_a_directory',
      stage: 'fs',
    });
  }
  if (stat.size > MAX_TEXT_BYTES) {
    throw new FileTooLargeError(normalized, stat.size);
  }

  return {
    relPath: normalized,
    language: detectLanguage(relPath),
    content: readFileSync(absolute, 'utf8'),
  };
}

/**
 * Write text to a file inside the workspace — the one place Fixora modifies the user's code, and only
 * ever to apply a repair the user accepted. Same guards as reading: the path is workspace-relative and
 * run through `assertInsideWorkspace`, and a secret-denylisted path is refused outright. It writes to an
 * existing file only (a repair replaces code that was analyzed), never creates new files here.
 */
export function writeTextFile(root: string, relPath: string, content: string): void {
  const normalized = relPath.replace(/\\/g, '/');
  if (isSecretPath(normalized)) {
    throw new SecretFileError(normalized);
  }
  const absolute = assertInsideWorkspace(join(root, relPath), root);
  const stat = statSync(absolute);
  if (stat.isDirectory()) {
    throw new UserFacingError('That path is a folder, so Fixora will not write over it.', {
      code: 'is_a_directory',
      stage: 'fs',
    });
  }
  writeFileSync(absolute, content, 'utf8');
}

export class SecretFileError extends Error {
  readonly code = 'SECRET_FILE' as const;
  constructor(readonly relPath: string) {
    super('This file is on the secrets denylist and is never read into Fixora.');
    this.name = 'SecretFileError';
  }
}

export class FileTooLargeError extends Error {
  readonly code = 'FILE_TOO_LARGE' as const;
  constructor(
    readonly relPath: string,
    readonly size: number,
  ) {
    super('This file is too large to open in the editor.');
    this.name = 'FileTooLargeError';
  }
}
