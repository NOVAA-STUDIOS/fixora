import { useEffect } from 'react';

import { subscribe } from '../../lib/bridge.js';

import { useWorkspaceStore } from './workspace-store.js';

/**
 * Keeps the file tree in sync with the disk. Main watches the workspace (debounced, ignore-aware)
 * and pushes `workspace:filesChanged` with the directories whose contents changed; here we re-list
 * exactly those, preserving what the user had expanded. The renderer never polls — the push is the
 * signal, which is what keeps the tree live without a busy loop.
 */
export function useFileWatch(): void {
  const refreshDir = useWorkspaceStore((s) => s.refreshDir);

  useEffect(() => {
    return subscribe('workspace:filesChanged', ({ changedDirs }) => {
      for (const dir of changedDirs) {
        void refreshDir(dir);
      }
    });
  }, [refreshDir]);
}
