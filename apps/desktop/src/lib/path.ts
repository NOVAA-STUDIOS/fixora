/**
 * Browser-safe path helpers for the renderer. The renderer is sandboxed and has no `node:path`
 * (invariant I2); all paths it handles are workspace-relative POSIX strings from the IPC layer, so
 * a handful of string operations is all it needs.
 */

/** The final segment of a `/`-separated path. */
export function basename(relPath: string): string {
  const trimmed = relPath.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

/** The parent directory of a `/`-separated path, or '' for a top-level entry. */
export function dirname(relPath: string): string {
  const trimmed = relPath.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  return slash === -1 ? '' : trimmed.slice(0, slash);
}
