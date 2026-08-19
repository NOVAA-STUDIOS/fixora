import { relative, sep } from 'node:path';

import { watch, type FSWatcher } from 'chokidar';

import type { IgnoreMatcher } from '../services/fs/ignore-rules.js';
import { detectLanguage, isDeepLanguage } from '../services/fs/language.js';
import { isSecretPath } from '../services/fs/secrets-denylist.js';

/**
 * Watch Mode (off by default, Settings): re-analyze a file the moment it's saved, instead of
 * waiting for the user to click Analyze again. A SEPARATE watcher from `services/fs/watcher.ts` —
 * that one only tracks `add`/`unlink`/`addDir`/`unlinkDir` (the file tree's own shape), so an
 * in-place edit to an existing file never fires it at all. This one watches `change` specifically,
 * for exactly that case.
 *
 * Debounced per file, not globally: a save-on-format editor can fire several `change` events for
 * the same file in quick succession (write, then a metadata touch), and a save to file A must
 * never delay or coalesce with an unrelated save to file B.
 */
export type AnalysisWatcher = { close: () => Promise<void> };

const DEBOUNCE_MS = 1500;

export function createAnalysisWatcher(
  root: string,
  ignore: IgnoreMatcher,
  onFileChanged: (relPath: string) => void,
): AnalysisWatcher {
  const toRel = (absolute: string): string => relative(root, absolute).split(sep).join('/');

  const watcher: FSWatcher = watch(root, {
    ignoreInitial: true,
    followSymlinks: false,
    ignored: (absolute) => {
      const rel = toRel(absolute);
      if (rel === '' || rel.startsWith('..')) return false;
      return ignore.ignores(rel);
    },
  });

  const timers = new Map<string, NodeJS.Timeout>();

  watcher.on('change', (absolute) => {
    const rel = toRel(absolute);
    // Only a file Fixora would actually analyze — re-analyzing a README save, or one the secrets
    // denylist refuses to read, would be pure waste (and for the latter, a path Fixora must not
    // read at all).
    const language = detectLanguage(rel);
    if (language === null || !isDeepLanguage(language) || isSecretPath(rel)) return;

    const existing = timers.get(rel);
    if (existing !== undefined) clearTimeout(existing);
    timers.set(
      rel,
      setTimeout(() => {
        timers.delete(rel);
        onFileChanged(rel);
      }, DEBOUNCE_MS),
    );
  });

  return {
    close: async () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      await watcher.close();
    },
  };
}
