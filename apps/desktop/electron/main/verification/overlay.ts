import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * A verification overlay (ADR-003): a throwaway copy of the workspace where a proposed fix is applied,
 * so the analyzers run against the patch **without ever touching the user's files**. The real file is
 * never mutated to verify — a crash mid-verify must not leave a half-patched repo.
 *
 * Heavy directories (node_modules, .git, build outputs) are skipped in the copy; `node_modules` is then
 * junction-linked from the real workspace so the type-checker and linters still resolve dependencies
 * without paying to copy them. Source-only copies are fast; the hardlink-CoW optimisation for very large
 * repos (ADR-003) is a later refinement.
 *
 * Symbolic links are **skipped**, not recreated. This is the fix for a release blocker: `cpSync`'s
 * recursive copy recreates every symlink it finds by calling the OS `symlink()` syscall, which Windows
 * refuses with `EPERM: operation not permitted, symlink` unless the process holds
 * SeCreateSymbolicLinkPrivilege — which a normal user (and a packaged app) does not. A project
 * containing a single committed symlink therefore made every repair fail with a generic internal error.
 * Skipping them is not a workaround: analysis itself skips symlinks when it walks the tree
 * (`entry.isSymbolicLink()` -> continue), so a symlinked file is never analyzed and thus never a repair
 * target. The overlay only needs the real files the analyzers actually look at. NTFS junctions report as
 * symbolic links here too, so they take the same safe path.
 */

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
  '.turbo',
  '.venv',
  '__pycache__',
  '.mypy_cache',
  '.ruff_cache',
]);

export interface Overlay {
  root: string;
  dispose(): void;
}

/**
 * Copy a source tree into the overlay, one entry at a time.
 *
 * Deliberately not `cpSync`: we must decide what to do with symlinks ourselves (skip them), and a
 * single unreadable or locked file must not abort the whole verification — the overlay is best-effort
 * scaffolding around one patched file, not a backup. Anything we cannot copy is simply absent from the
 * overlay, which at worst degrades a check, and that degradation is already reported in the verdict.
 */
function copyTree(srcRoot: string, dstRoot: string): void {
  let entries;
  try {
    entries = readdirSync(srcRoot, { withFileTypes: true });
  } catch {
    return; // unreadable directory — skip its subtree rather than fail the overlay
  }
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const src = join(srcRoot, entry.name);
    const dst = join(dstRoot, entry.name);
    try {
      // lstat, never stat: a symlink must be identified as one BEFORE its target is followed, or we
      // would dereference it and copy through it — the exact thing analysis refuses to do.
      const stat = lstatSync(src);
      if (stat.isSymbolicLink()) continue; // skip symlinks and junctions — see file header
      if (stat.isDirectory()) {
        mkdirSync(dst, { recursive: true });
        copyTree(src, dst);
      } else if (stat.isFile()) {
        copyFileSync(src, dst);
      }
      // sockets, FIFOs, devices: nothing an analyzer reads — skip silently
    } catch {
      // A single file we cannot copy (locked, permission, vanished mid-walk) is skipped, not fatal.
    }
  }
}

export function createOverlay(sourceRoot: string): Overlay {
  const root = mkdtempSync(join(tmpdir(), 'fixora-verify-'));

  copyTree(sourceRoot, root);

  const realModules = join(sourceRoot, 'node_modules');
  if (existsSync(realModules)) {
    try {
      // 'junction' works on Windows without elevation; falls back cleanly elsewhere.
      symlinkSync(realModules, join(root, 'node_modules'), 'junction');
    } catch {
      // Best effort — without deps some checks (e.g. tsc types) degrade, which we report honestly.
    }
  }

  return {
    root,
    dispose: () => {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // A temp dir we could not remove is the OS's problem to reap, not a reason to fail a repair.
      }
    },
  };
}

/** Write the patched content into the overlay at a workspace-relative path. */
export function patchOverlayFile(overlayRoot: string, relPath: string, content: string): void {
  const target = join(overlayRoot, relPath);
  // The parent dir was copied with the tree, but guard against a brand-new file just in case.
  const dir = dirname(target);
  if (!existsSync(dir)) return;
  writeFileSync(target, content, 'utf8');
}
