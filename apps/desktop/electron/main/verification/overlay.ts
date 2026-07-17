import {
  cpSync,
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

/**
 * A verification overlay (ADR-003): a throwaway copy of the workspace where a proposed fix is applied,
 * so the analyzers run against the patch **without ever touching the user's files**. The real file is
 * never mutated to verify — a crash mid-verify must not leave a half-patched repo.
 *
 * Heavy directories (node_modules, .git, build outputs) are skipped in the copy; `node_modules` is then
 * junction-linked from the real workspace so the type-checker and linters still resolve dependencies
 * without paying to copy them. Source-only copies are fast; the hardlink-CoW optimisation for very large
 * repos (ADR-003) is a later refinement.
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

export function createOverlay(sourceRoot: string): Overlay {
  const root = mkdtempSync(join(tmpdir(), 'fixora-verify-'));

  cpSync(sourceRoot, root, {
    recursive: true,
    // Returning false for a directory prunes the whole subtree.
    filter: (src) => !SKIP_DIRS.has(basename(src)),
  });

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
