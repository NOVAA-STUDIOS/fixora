import { create } from 'zustand';

import { invoke } from '../../lib/bridge.js';
import { basename } from '../../lib/path.js';

import { disposeModel, modelTextFor } from './models.js';

/**
 * Open editor tabs (ADR-015: Monaco owns the *text*; this store owns *which files are open*, *which is
 * active*, and *which have unsaved edits* — the UI facts the user acted on). It deliberately holds **no
 * file content**: that lives in Monaco's models, and mirroring it here would be the classic
 * double-source-of-truth bug (double writes, lost undo, cursor jumps).
 *
 * Saving reads the text straight from the model and writes it through the guarded `fs:writeFile`
 * channel, so the only copy of the text stays the one the user is editing.
 */
export type EditorTab = {
  relPath: string;
  name: string;
  language: string | null;
};

type EditorState = {
  tabs: EditorTab[];
  activeTab: string | null;
  /** Paths with unsaved edits. Drives the tab dot and the close confirmation. */
  dirty: string[];
  saving: string | null;
  saveError: string | null;

  openFile: (relPath: string, language: string | null) => void;
  closeTab: (relPath: string) => void;
  setActive: (relPath: string) => void;
  markDirty: (relPath: string) => void;
  markClean: (relPath: string) => void;
  /** Write the active (or given) file's model text to disk. Returns true on success. */
  save: (relPath?: string) => Promise<boolean>;
  isDirty: (relPath: string) => boolean;
  /** Drop every tab and its model — what closing the workspace does. Returns paths left unsaved. */
  closeAll: () => string[];
};

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activeTab: null,
  dirty: [],
  saving: null,
  saveError: null,

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
    set({
      tabs: next,
      activeTab: nextActive,
      dirty: get().dirty.filter((p) => p !== relPath),
    });
  },

  setActive: (relPath) => {
    set({ activeTab: relPath });
  },

  markDirty: (relPath) => {
    set((s) => (s.dirty.includes(relPath) ? s : { dirty: [...s.dirty, relPath] }));
  },

  markClean: (relPath) => {
    set((s) => ({ dirty: s.dirty.filter((p) => p !== relPath) }));
  },

  isDirty: (relPath) => get().dirty.includes(relPath),

  closeAll: () => {
    const abandoned = get().dirty;
    for (const tab of get().tabs) disposeModel(tab.relPath);
    set({ tabs: [], activeTab: null, dirty: [], saving: null, saveError: null });
    return abandoned;
  },

  save: async (relPath) => {
    const target = relPath ?? get().activeTab;
    if (target === null) return false;
    const content = modelTextFor(target);
    if (content === null) return false;

    set({ saving: target, saveError: null });
    const result = await invoke('fs:writeFile', { relPath: target, content });
    set({ saving: null });
    if (!result.ok) {
      set({ saveError: result.error.message });
      return false;
    }
    get().markClean(target);
    return true;
  },
}));
