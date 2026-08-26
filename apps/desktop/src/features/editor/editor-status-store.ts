import { create } from 'zustand';

/**
 * Stores caret position, language and encoding for the status bar.
 * Kept separate from editor-store.ts so a caret move on every keystroke
 * does not re-render the tab strip.
 */
type EditorStatusState = {
  line: number | null;
  column: number | null;
  language: string | null;
  /** null = UTF-8/default (no badge needed) — see `editor-area.tsx`'s `ENCODING_LABEL`, which is
   *  the single source for what counts as worth naming. */
  encoding: string | null;
  setPosition: (line: number, column: number) => void;
  setLanguage: (language: string | null) => void;
  setEncoding: (encoding: string | null) => void;
  clear: () => void;
};

export const useEditorStatusStore = create<EditorStatusState>((set) => ({
  line: null,
  column: null,
  language: null,
  encoding: null,
  setPosition: (line, column) => {
    set({ line, column });
  },
  setLanguage: (language) => {
    set({ language });
  },
  setEncoding: (encoding) => {
    set({ encoding });
  },
  clear: () => {
    set({ line: null, column: null, language: null, encoding: null });
  },
}));
