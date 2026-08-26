import { create } from 'zustand';

/**
 * Stores caret position and language for the status bar.
 * Kept separate from editor-store.ts so a caret move on every keystroke
 * does not re-render the tab strip.
 * Note: actual file encoding is detected and shown in editor-area.tsx
 * (UTF-8, UTF-16 LE/BE, Latin-1) — not tracked here since status bar
 * currently shows a static 'UTF-8' label (known gap, see editor-area.tsx).
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
