import { randomBytes } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, posix } from 'node:path';

import { UserFacingError } from '@fixora/shared-types';

import { fsTry } from './fs-errors.js';
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
  const entries = fsTry('list', relPath === '' ? 'this folder' : relPath, () =>
    readdirSync(absolute, { withFileTypes: true }),
  );

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
  // lstat, not stat: a symlink must be identified as one BEFORE its target is followed. A broken
  // link then reports itself as broken rather than as a missing file.
  const stat = fsTry('read', normalized, () => lstatSync(absolute));
  const target = stat.isSymbolicLink() ? fsTry('read', normalized, () => statSync(absolute)) : stat;
  if (target.isDirectory()) {
    throw new UserFacingError('That path is a folder, not a file, so it cannot be opened.', {
      code: 'is_a_directory',
      stage: 'fs',
    });
  }
  if (target.size > MAX_TEXT_BYTES) {
    throw new FileTooLargeError(normalized, target.size);
  }

  return {
    relPath: normalized,
    language: detectLanguage(relPath),
    content: fsTry('read', normalized, () => readFileSync(absolute, 'utf8')),
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
  const stat = fsTry('write to', normalized, () => lstatSync(absolute));

  /*
   * Symlinks: fs-service and analysis MUST agree, and they did not.
   *
   * `analysis-service.ts` skips symlinks when walking (`entry.isSymbolicLink()` -> continue), so a
   * symlinked file is never analyzed. But this function used `statSync`, which FOLLOWS the link —
   * so the same file was readable and WRITABLE through the fs channels while being invisible to
   * analysis. A repair could be written through a link into a file the analyzer never examined,
   * which is the worst asymmetry available to a tool that verifies before it writes.
   *
   * Resolved toward the stricter side: writing THROUGH a link is refused. Reading stays allowed —
   * harmless, and useful for viewing — but a write now follows the analyzer's view of the project.
   * The path guard already resolves the real path, so this is about intent rather than escape: even
   * a link pointing safely inside the workspace targets a file analysis never checked.
   */
  if (stat.isSymbolicLink()) {
    throw new UserFacingError(
      `${normalized} is a symbolic link. Fixora does not write through links, because analysis ` +
        'skips them — the file behind this link was never checked. Open the real file and repair it there.',
      { code: 'fs_symlink_write', action: { type: 'none', label: 'Dismiss' }, stage: 'fs' },
    );
  }
  if (stat.isDirectory()) {
    throw new UserFacingError('That path is a folder, so Fixora will not write over it.', {
      code: 'is_a_directory',
      stage: 'fs',
    });
  }
  // Atomic replace: write the full new content to a sibling temp file, then rename it over the
  // target. A repair must never partially modify a source file — a crash or a disk-full partway
  // through a direct `writeFileSync` would leave the user's code truncated. `rename` within the same
  // directory is atomic on NTFS and POSIX: the file is either the old bytes or all of the new bytes,
  // never a half-written mix. If anything fails, the temp file is removed and the original is left
  // exactly as it was (repair rollback, requirement §8).
  const tmp = join(dirname(absolute), `.${randomBytes(6).toString('hex')}.fixora-tmp`);
  fsTry('write to', normalized, () => {
    writeFileSync(tmp, content, 'utf8');
    try {
      renameSync(tmp, absolute);
    } catch (error) {
      // The rename failed, so the target is untouched. Clean up the temp before surfacing the error.
      try {
        rmSync(tmp, { force: true });
      } catch {
        // A leftover temp file is harmless (dotfile, ignored); the real error is the rename's.
      }
      throw error;
    }
  });
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
