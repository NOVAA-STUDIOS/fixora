import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * The filesystem boundary (Security §3). **Path traversal is the #1 realistic exploit against a
 * tool that reads local files**, and the mitigation is boring and total: resolve symlinks and
 * junctions to a real path, then check that real path is inside the workspace by *path segment*,
 * never by string prefix.
 *
 * A string prefix check is not a defence: `..` escapes it, a symlink inside the workspace can
 * point anywhere, an NTFS junction is a symlink Windows does not call one, a UNC path
 * (`\\host\share`) is a network location, and `/workspace-evil` naively "starts with"
 * `/workspace`. So we resolve first, compare segments second, and decide last.
 *
 * Every handler that touches a path calls `assertInsideWorkspace`. There is no fast path and no
 * "internal caller so it's fine".
 */

export class PathOutsideWorkspaceError extends Error {
  readonly code = 'PATH_OUTSIDE_WORKSPACE' as const;
  constructor(readonly attempted: string) {
    super('Refused a path outside the open workspace.');
    this.name = 'PathOutsideWorkspaceError';
  }
}

/**
 * Is `resolvedCandidate` the root itself, or strictly beneath it? Pure — no filesystem — so it is
 * exhaustively property-testable. Both inputs must already be resolved to real, absolute paths.
 *
 * The `..`-and-not-absolute test is what rejects both the escape (`relative` yields `..\…`) and
 * the sibling-prefix trick (`/workspace` → `/workspace-evil` yields `..\workspace-evil`).
 */
export function isInsideBoundary(resolvedCandidate: string, resolvedRoot: string): boolean {
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel === '') return true; // the root itself
  return !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}

/**
 * Resolve `candidate` to a real path, following symlinks/junctions on every segment that exists.
 * A path that does not exist yet (a file about to be created) still gets its **existing ancestor**
 * resolved, so a symlink partway up cannot smuggle the tail out of the workspace.
 */
function realpathAllowingMissingTail(candidate: string): string {
  const absolute = resolve(candidate);
  try {
    return realpathSync.native(absolute);
  } catch {
    // The full path does not exist. Resolve the deepest existing ancestor (which follows any
    // symlinks in it), then re-attach the non-existent remainder.
    const parent = resolve(absolute, '..');
    if (parent === absolute) return absolute; // reached the filesystem root
    const resolvedParent = realpathAllowingMissingTail(parent);
    const tail = relative(parent, absolute);
    return resolve(resolvedParent, tail);
  }
}

/**
 * Assert `candidate` resolves to a location inside `root`. Returns the resolved real path on
 * success; throws `PathOutsideWorkspaceError` otherwise. The caller logs the throw as a security
 * event (Security §3) and surfaces `PATH_OUTSIDE_WORKSPACE`, never the resolved path.
 *
 * `root` is resolved too, because the workspace root can itself be reached through a symlink
 * (a user opening `/tmp/link-to-project`), and both sides must be in the same real namespace for
 * the segment comparison to mean anything.
 */
export function assertInsideWorkspace(candidate: string, root: string): string {
  const resolvedRoot = realpathAllowingMissingTail(root);
  const resolvedCandidate = realpathAllowingMissingTail(candidate);
  if (!isInsideBoundary(resolvedCandidate, resolvedRoot)) {
    throw new PathOutsideWorkspaceError(candidate);
  }
  return resolvedCandidate;
}
