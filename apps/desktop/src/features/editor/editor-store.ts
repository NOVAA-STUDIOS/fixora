import { create } from 'zustand';

import { basename } from '../../lib/path.js';

/**
 * Open editor tabs (ADR-015: Monaco owns the *text*; this store owns *which files are open* and
 * *which is active* — the UI facts the user clicked). It deliberately holds **no file content** —
 * that lives in Monaco's models, and mirroring it here would be the classic double-source-of-truth
 * bug the blueprint calls out (double writes, lost undo, cursor jumps).
 */
export type EditorTab = {
  relPath: string;
  name: string;
  language: string | null;
};

type EditorState = {
  tabs: EditorTab[];
  activeTab: string | null;

  openFile: (relPath: string, language: string | null) => void;
  closeTab: (relPath: string) => void;
  setActive: (relPath: string) => void;
};

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activeTab: null,

  openFile: (relPath, language) => {
    const { tabs } = get();
    if (!tabs.some((t) => t.relPath === relPath)) {
      set({ tabs: [...tabs, { relPath, name: basename(relPath), language }] });
    }
    set({ activeTab: relPath });
  },

  closeTab: (relPath) => {
    const { tabs, activeTab } = get();
    const index = tabs.findIndex((t) => t.relPath === relPath);
    if (index === -1) return;
    const next = tabs.filter((t) => t.relPath !== relPath);
    // If the closed tab was active, activate its neighbour — the tab to the left, else the right.
    let nextActive = activeTab;
    if (activeTab === relPath) {
      nextActive = next[index - 1]?.relPath ?? next[index]?.relPath ?? null;
    }
    set({ tabs: next, activeTab: nextActive });
  },

  setActive: (relPath) => {
    set({ activeTab: relPath });
  },
}));
