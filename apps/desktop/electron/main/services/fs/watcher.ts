import { relative, sep } from 'node:path';

import { watch, type FSWatcher } from 'chokidar';

import { type IgnoreMatcher } from './ignore-rules.js';

/**
 * The workspace file watcher (FR-1). It must be **debounced and ignore-aware from the first commit,
 * not "optimised later"** (roadmap M2 risk): a save-on-format in a large repo can fire hundreds of
 * events, and walking `node_modules` would swamp it. So it ignores the same set the tree does, and
 * it coalesces a burst of events into one batch of *changed directories* — the renderer re-lists
 * only those, rather than re-reading the tree.
 */
export type WorkspaceWatcher = { close: () => Promise<void> };

export function createWorkspaceWatcher(
  root: string,
  ignore: IgnoreMatcher,
  onBatch: (changedDirs: string[]) => void,
  debounceMs = 250,
): WorkspaceWatcher {
  const toRel = (absolute: string): string => relative(root, absolute).split(sep).join('/');

  const watcher: FSWatcher = watch(root, {
    ignoreInitial: true,
    // Do not descend or resolve symlinks — the same stance the tree and the path guard take.
    followSymlinks: false,
    ignored: (absolute) => {
      const rel = toRel(absolute);
      if (rel === '' || rel.startsWith('..')) return false;
      return ignore.ignores(rel);
    },
  });

  const pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;

  const flush = (): void => {
    timer = null;
    const dirs = [...pending];
    pending.clear();
    if (dirs.length > 0) onBatch(dirs);
  };

  const note = (absolute: string): void => {
    const rel = toRel(absolute);
    // The directory whose listing changed is the parent of the changed entry.
    const slash = rel.lastIndexOf('/');
    pending.add(slash === -1 ? '' : rel.slice(0, slash));
    timer ??= setTimeout(flush, debounceMs);
  };

  watcher.on('add', note).on('unlink', note).on('addDir', note).on('unlinkDir', note);

  return {
    close: async () => {
      if (timer !== null) clearTimeout(timer);
      await watcher.close();
    },
  };
}
