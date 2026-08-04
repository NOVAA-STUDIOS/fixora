import type * as monaco from 'monaco-editor';

/**
 * The currently-mounted editor's cursor, readable without importing Monaco.
 *
 * Proceed Mode needs the caret to choose an edit scope. The cursor is Monaco's own state, so this
 * exposes it rather than mirroring it into a store (which would be a second source of truth). It
 * lives in its own module — and imports Monaco as a TYPE only, which erases at compile time —
 * because reaching into `code-editor.tsx` would drag the whole editor into every consumer's module
 * graph (it did: it booted Monaco inside jsdom and broke the panel tests).
 */

let mounted: monaco.editor.IStandaloneCodeEditor | null = null;

/** Called by the editor on mount/unmount. Not for general use. */
export function setActiveEditor(editor: monaco.editor.IStandaloneCodeEditor | null): void {
  mounted = editor;
}

/**
 * The mounted editor, or null.
 *
 * Exposed so `models.ts` can detach a model from the editor before disposing it — the cache owns
 * the models, the editor borrows one, and a borrowed model torn down without notice leaves every
 * in-flight worker request resolving into nothing.
 */
export function activeEditor(): monaco.editor.IStandaloneCodeEditor | null {
  return mounted;
}

/** The caret's 1-based line, or null when no editor is mounted. */
export function activeCursorLine(): number | null {
  return mounted?.getPosition()?.lineNumber ?? null;
}

/** The selected line range when there is a real (non-empty) selection, else null. */
export function activeSelectionRange(): { startLine: number; endLine: number } | null {
  const selection = mounted?.getSelection();
  if (selection === undefined || selection === null || selection.isEmpty()) return null;
  return { startLine: selection.startLineNumber, endLine: selection.endLineNumber };
}
