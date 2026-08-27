import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import ignoreFactory, { type Ignore } from 'ignore';

/**
 * `.gitignore`-aware ignore rules for the file tree (FR-1). Built on the `ignore` package, which
 * implements gitignore semantics exactly (negations, directory rules, globs) rather than our
 * approximation of them — a tree that disagrees with `git status` about what is ignored is a tree
 * a developer distrusts.
 *
 * On top of the workspace's own `.gitignore`, a small always-ignore set keeps the tree usable and
 * fast on a 10k-file repo: `.git` internals and the dependency/build directories nobody wants to
 * browse. These are defaults, not policy — a file the user explicitly opens is still readable; this
 * only governs what the *tree* shows and what the *indexer* walks.
 */
const ALWAYS_IGNORE = [
  '.git/',
  'node_modules/',
  '.turbo/',
  'dist/',
  'build/',
  'out/',
  'coverage/',
  '.next/',
  '.venv/',
  '__pycache__/',
];

export type IgnoreMatcher = {
  /** True if this workspace-relative POSIX path should be hidden from the tree / skipped by the indexer. */
  ignores: (relPath: string) => boolean;
};

export function loadIgnoreRules(workspaceRoot: string): IgnoreMatcher {
  const ig: Ignore = ignoreFactory();
  ig.add(ALWAYS_IGNORE);

  // The workspace's own .gitignore, if present. A missing or unreadable one is not an error — many
  // real repos have none, and the always-ignore set still applies.
  try {
    ig.add(readFileSync(join(workspaceRoot, '.gitignore'), 'utf8'));
  } catch {
    // no .gitignore, or unreadable — fine.
  }

  // .fixoraignore extends .gitignore — same syntax, Fixora-only scope. Additive only: it can hide
  // more from the tree/indexer/analyzers than git already does, never un-ignore what git tracks.
  // Missing or unreadable is the same non-error as .gitignore above.
  try {
    ig.add(readFileSync(join(workspaceRoot, '.fixoraignore'), 'utf8'));
  } catch {
    // no .fixoraignore, or unreadable — fine.
  }

  return {
    ignores: (relPath) => {
      const normalized = relPath.replace(/\\/g, '/');
      if (normalized === '') return false;
      return ig.ignores(normalized);
    },
  };
}
