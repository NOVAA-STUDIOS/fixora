import { create } from 'zustand';

/**
 * The status bar's view of the active editor: caret position and the open file's language.
 * Separate from `editor-store.ts` (which owns tabs/dirty/save) because this is Monaco's own live
 * cursor state, updated on every caret move — folding it into the tab store would re-render every
 * tab-strip consumer on every keystroke's cursor movement, not just the status bar.
 *
 * Encoding is always UTF-8: `fs-service.ts` reads and writes every file as UTF-8 unconditionally
 * (`readTextFile`/`writeTextFile`), so there is nothing to detect — this is a fact about the app,
 * not a per-file property Monaco reports.
 */
type EditorStatusState = {
  line: number | null;
  column: number | null;
  language: string | null;
  setPosition: (line: number, column: number) => void;
  setLanguage: (language: string | null) => void;
  clear: () => void;
};

export const useEditorStatusStore = create<EditorStatusState>((set) => ({
  line: null,
  column: null,
  language: null,
  setPosition: (line, column) => {
    set({ line, column });
  },
  setLanguage: (language) => {
    set({ language });
  },
  clear: () => {
    set({ line: null, column: null, language: null });
  },
}));
