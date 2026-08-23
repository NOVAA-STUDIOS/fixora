import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';

import { UserFacingError } from '@fixora/shared-types';

import { decodeBuffer, detectEncoding, encodeText, type FileEncoding } from './encoding.js';
import { fsTry, fsTryAsync } from './fs-errors.js';
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
  /** How the bytes were decoded, so a write can put them back the same way. */
  encoding: FileEncoding;
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
export async function listDirectory(
  root: string,
  relPath: string,
  ignore: IgnoreMatcher,
): Promise<DirEntry[]> {
  const absolute = assertInsideWorkspace(join(root, relPath), root);
  // Async: this is the tree's lazy-expansion call, fired on every folder open and every directory
  // the user expands. `readdirSync` blocked the whole main process — every pending IPC call, every
  // window message — for as long as the OS took to answer, which on a large directory or a
  // network/cloud-synced drive is exactly the multi-second stall that shows up as "Not Responding".
  const entries = await fsTryAsync('list', relPath === '' ? 'this folder' : relPath, () =>
    readdir(absolute, { withFileTypes: true }),
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

  // Read as BYTES, then decode. Reading straight to a utf8 string silently replaced every
  // non-ASCII character in a UTF-16 or Latin-1 file with U+FFFD — invisible until the file was
  // written back, at which point the replacement was permanent.
  const bytes = fsTry('read', normalized, () => readFileSync(absolute));
  const encoding = detectEncoding(bytes);

  return {
    relPath: normalized,
    language: detectLanguage(relPath),
    content: decodeBuffer(bytes, encoding),
    encoding,
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
  /*
   * A one-generation backup, written BEFORE the target is touched.
   *
   * The rename below is atomic, so the file is never half-written — but "atomic" only guarantees
   * the write is all-or-nothing, not that it was the write the user wanted. A verified-but-wrong
   * repair, or an Apply the user immediately regrets after closing the editor (Monaco's undo stack
   * lives in memory and does not survive a restart), previously had no recovery path at all. This
   * is that path: the previous bytes, on disk, next to the file.
   *
   * Removed on success — a backup that outlives its usefulness becomes clutter in someone's repo
   * and, worse, drifts into being mistaken for a real source file. It survives only a FAILED write,
   * which is exactly when it is worth having.
   */
  const backup = `${absolute}.fixora-backup`;
  let backupWritten = false;
  try {
    writeFileSync(backup, readFileSync(absolute), { flag: 'w' });
    backupWritten = true;
  } catch (error) {
    // Not fatal: a repair must not be refused because a backup could not be written (a read-only
    // directory, a full disk). The atomic rename below still protects against a partial write.
    console.error('[fs] could not write repair backup', {
      relPath: normalized,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  /*
   * Written back in the encoding it was READ in, detected from the file's own current bytes.
   *
   * Detected here rather than threaded through as a parameter, on purpose: every write path —
   * Repair's apply, Proceed's Accept, a manual editor Save — goes through this function, and a
   * parameter is something each of them can forget or get wrong. The bytes on disk cannot be
   * forgotten. This function already re-reads the file for its guards, so the detection is free.
   */
  let encoding: FileEncoding = 'utf8';
  try {
    encoding = detectEncoding(readFileSync(absolute));
  } catch {
    // Unreadable here means the write below will fail too and report properly; defaulting to utf8
    // keeps this from being the thing that throws first, with a less useful message.
  }
  const bytes = encodeText(content, encoding);

  fsTry('write to', normalized, () => {
    try {
      writeFileSync(tmp, bytes);
      renameSync(tmp, absolute);
    } catch (error) {
      // The write or rename failed, so the target is untouched. Clean up the temp and KEEP the
      // backup — a failed write is precisely the case where the user may need it.
      try {
        rmSync(tmp, { force: true });
      } catch {
        // A leftover temp file is harmless (dotfile, ignored); the real error is the write's.
      }
      throw error;
    }
    // Succeeded: the new bytes are in place, so the backup has nothing left to protect.
    if (backupWritten) {
      try {
        rmSync(backup, { force: true });
      } catch {
        // A leftover backup is harmless — never fail a successful repair over cleanup.
      }
    }
    verifyWrittenFile(absolute, normalized, bytes);
  });
}

/**
 * PERMANENT write-verification invariant (Q3 data-integrity hardening — not tied to the temporary
 * diagnostic gate above `writeTextFile`, and NOT a fix for the incident's still-unknown root cause).
 * Whatever caused it, the property this restores is simple: Fixora must never report a write as
 * successful unless the bytes actually on disk match what was intended. Runs on every write through
 * `writeTextFile` — Repair's apply, Proceed's Accept, and a manual editor Save alike, since this is
 * the one function all three go through. A mismatch fails closed: the thrown UserFacingError
 * propagates to the caller as a refusal, never a silent, wrongly-reported success.
 *
 * Exported (not just inlined into `writeTextFile`) so it is directly testable: the only realistic way
 * to exercise "the file was NOT what we intended" is to arrange that disk state directly and check
 * this function's response to it, rather than trying to race the atomic rename itself — which is a
 * single synchronous call in `writeTextFile` with no yield point another same-process actor could
 * ever land in between; only a genuinely separate OS process could do that, which is exactly the
 * class of cause this guards against without needing to know which one it was.
 */
export function verifyWrittenFile(absolute: string, normalized: string, expected: Buffer): void {
  const actual = readFileSync(absolute);
  if (!actual.equals(expected)) {
    const allZero = actual.length > 0 && actual.every((byte) => byte === 0);
    // Diagnostic-safe: byte lengths and content HASHES only. Never the content itself — it may be a
    // user's proprietary source or, in the general case, contain secrets.
    console.error('[fs] write verification FAILED — target does not match what was written', {
      file: normalized,
      expectedByteLength: expected.length,
      actualByteLength: actual.length,
      expectedHash: createHash('sha256').update(expected).digest('hex'),
      actualHash: createHash('sha256').update(actual).digest('hex'),
      actualAllZero: allZero,
    });
    throw new UserFacingError(
      `Fixora wrote ${normalized}, but reading it back shows different bytes than what was ` +
        'written. This looks like a data-integrity problem, not a normal failure, so the change ' +
        'was NOT recorded as applied. Check this file in another editor before trusting its ' +
        'contents, and avoid further edits to it until you have verified it.',
      {
        code: 'write_verification_failed',
        action: { type: 'none', label: 'Dismiss' },
        stage: 'fs',
      },
    );
  }
}

/** True if a workspace-relative path already exists — used by the create/rename operations below
 * to fail with a clear "already there" message rather than an OS errno. */
function exists(root: string, relPath: string): boolean {
  return existsSync(assertInsideWorkspace(join(root, relPath), root));
}

/** File tree "New File" — refuses if the path already exists or is secret-denylisted. Creates the
 * file empty; the editor opens it immediately after via the normal fs:readFile path. */
export function createFile(root: string, relPath: string): void {
  const normalized = relPath.replace(/\\/g, '/');
  if (isSecretPath(normalized)) throw new SecretFileError(normalized);
  if (exists(root, relPath)) {
    throw new UserFacingError('A file or folder with this name already exists here.', {
      code: 'already_exists',
      action: { type: 'none', label: 'Dismiss' },
      stage: 'fs',
    });
  }
  const absolute = assertInsideWorkspace(join(root, relPath), root);
  fsTry('create', normalized, () => {
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, '', 'utf8');
  });
}

/**
 * Write a generated file into the workspace, creating any missing parent directories and
 * overwriting an existing file at that path (regenerating a previously-written file, e.g. the
 * GitHub Actions panel's workflow, is expected to replace it — unlike `createFile`, which refuses
 * an existing path for the "New File" UI, where that would silently discard the user's content).
 */
export function writeWorkspaceFile(root: string, relPath: string, content: string): void {
  const normalized = relPath.replace(/\\/g, '/');
  if (isSecretPath(normalized)) throw new SecretFileError(normalized);
  const absolute = assertInsideWorkspace(join(root, relPath), root);
  fsTry('write to', normalized, () => {
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, 'utf8');
  });
}

/** File tree "New Folder". */
export function createDirectory(root: string, relPath: string): void {
  const normalized = relPath.replace(/\\/g, '/');
  if (exists(root, relPath)) {
    throw new UserFacingError('A file or folder with this name already exists here.', {
      code: 'already_exists',
      action: { type: 'none', label: 'Dismiss' },
      stage: 'fs',
    });
  }
  const absolute = assertInsideWorkspace(join(root, relPath), root);
  fsTry('create', normalized, () => {
    mkdirSync(absolute, { recursive: true });
  });
}

/**
 * File tree Rename — also used for a same-directory move if a caller ever wants one, but the tree
 * only ever changes the final path segment. Both endpoints are guarded independently: the target
 * must land inside the workspace exactly as much as the source must have started there.
 */
export function renamePath(root: string, fromRelPath: string, toRelPath: string): void {
  const fromNormalized = fromRelPath.replace(/\\/g, '/');
  const toNormalized = toRelPath.replace(/\\/g, '/');
  if (isSecretPath(fromNormalized) || isSecretPath(toNormalized)) {
    throw new SecretFileError(isSecretPath(fromNormalized) ? fromNormalized : toNormalized);
  }
  if (exists(root, toRelPath)) {
    throw new UserFacingError('A file or folder with this name already exists here.', {
      code: 'already_exists',
      action: { type: 'none', label: 'Dismiss' },
      stage: 'fs',
    });
  }
  const fromAbsolute = assertInsideWorkspace(join(root, fromRelPath), root);
  const toAbsolute = assertInsideWorkspace(join(root, toRelPath), root);
  fsTry('rename', fromNormalized, () => {
    mkdirSync(dirname(toAbsolute), { recursive: true });
    renameSync(fromAbsolute, toAbsolute);
  });
}

/** File tree Delete — moves to nothing-recoverable by design (Electron has no cross-platform
 * trash API in main without an extra dependency); the confirmation dialog on the renderer side is
 * what stands in for "are you sure", the same as `workspace:removeRecent` and closing a workspace. */
export function deletePath(root: string, relPath: string): void {
  const normalized = relPath.replace(/\\/g, '/');
  if (isSecretPath(normalized)) throw new SecretFileError(normalized);
  const absolute = assertInsideWorkspace(join(root, relPath), root);
  fsTry('delete', normalized, () => {
    rmSync(absolute, { recursive: true, force: false });
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
