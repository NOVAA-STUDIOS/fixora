import { create } from 'zustand';

import { invoke } from '../../lib/bridge.js';
import { basename } from '../../lib/path.js';
import { useUiStore } from '../../stores/ui-store.js';

import { disposeModel, isModelDirty, markModelSaved, modelTextFor, refreshModelText } from './models.js';

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
  /** A second file shown side-by-side with `activeTab` (Ctrl+\ / "Open to the Side") — a second
   * Monaco instance viewing the same model cache (`models.ts`), which Monaco supports directly
   * (it is how VS Code's own split view works); no second copy of any file's text exists. */
  splitRelPath: string | null;
  /** Paths with unsaved edits. Drives the tab dot and the close confirmation. */
  dirty: string[];
  saving: string | null;
  saveError: string | null;

  openFile: (relPath: string, language: string | null) => void;
  closeTab: (relPath: string) => void;
  /** Close every tab except `relPath`. */
  closeOthers: (relPath: string) => void;
  /** Close every tab (dirty ones left open — same rule as `closeOthers`). Distinct from `closeAll`,
   * which is the workspace-close path and force-closes everything after its own confirmation. */
  closeAllTabs: () => void;
  setActive: (relPath: string) => void;
  setSplit: (relPath: string | null) => void;
  /** Recompute dirty from the model's own version baseline (see models.ts). */
  syncDirty: (relPath: string) => void;
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
  splitRelPath: null,
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
      splitRelPath: get().splitRelPath === relPath ? null : get().splitRelPath,
    });
  },

  closeOthers: (relPath) => {
    const { tabs, dirty } = get();
    // Never discard unsaved work silently: a dirty "other" tab stays open rather than being
    // force-closed, the same rule the single-tab close confirmation enforces.
    const toClose = tabs.filter((t) => t.relPath !== relPath && !dirty.includes(t.relPath));
    for (const t of toClose) disposeModel(t.relPath);
    const closedPaths = new Set(toClose.map((t) => t.relPath));
    set((s) => ({
      tabs: s.tabs.filter((t) => !closedPaths.has(t.relPath)),
      activeTab: relPath,
      splitRelPath: s.splitRelPath !== null && closedPaths.has(s.splitRelPath) ? null : s.splitRelPath,
    }));
  },

  closeAllTabs: () => {
    const { tabs, dirty } = get();
    const toClose = tabs.filter((t) => !dirty.includes(t.relPath));
    for (const t of toClose) disposeModel(t.relPath);
    const closedPaths = new Set(toClose.map((t) => t.relPath));
    set((s) => {
      const remaining = s.tabs.filter((t) => !closedPaths.has(t.relPath));
      return {
        tabs: remaining,
        activeTab: s.activeTab !== null && closedPaths.has(s.activeTab)
          ? (remaining[0]?.relPath ?? null)
          : s.activeTab,
        splitRelPath:
          s.splitRelPath !== null && closedPaths.has(s.splitRelPath) ? null : s.splitRelPath,
      };
    });
  },

  setActive: (relPath) => {
    set({ activeTab: relPath });
  },

  setSplit: (relPath) => {
    set({ splitRelPath: relPath });
  },

  syncDirty: (relPath) => {
    const dirty = isModelDirty(relPath);
    set((s) => {
      const has = s.dirty.includes(relPath);
      if (dirty === has) return s;
      return { dirty: dirty ? [...s.dirty, relPath] : s.dirty.filter((p) => p !== relPath) };
    });
  },

  markClean: (relPath) => {
    set((s) => ({ dirty: s.dirty.filter((p) => p !== relPath) }));
  },

  isDirty: (relPath) => get().dirty.includes(relPath),

  closeAll: () => {
    const abandoned = get().dirty;
    for (const tab of get().tabs) disposeModel(tab.relPath);
    set({ tabs: [], activeTab: null, splitRelPath: null, dirty: [], saving: null, saveError: null });
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
    markModelSaved(target);
    get().markClean(target);

    // Best-effort: formatting is a courtesy on top of a save that already succeeded, never a
    // reason to report the save itself as failed. A formatter erroring (a genuine syntax problem
    // the save just introduced) is silently left as-is — the file the user saved is still on disk
    // exactly as they wrote it, which is the correct fallback, not a dropped error.
    if (useUiStore.getState().formatOnSave) {
      void invoke('editor:formatFile', { relPath: target }).then((formatted) => {
        if (formatted.ok && formatted.value.ran && formatted.value.ok) {
          refreshModelText(target, formatted.value.content);
          markModelSaved(target);
          get().syncDirty(target);
        }
      });
    }

    return true;
  },
}));
