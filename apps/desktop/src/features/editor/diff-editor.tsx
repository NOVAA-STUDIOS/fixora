import type * as monaco from 'monaco-editor';
import { useEffect, useRef } from 'react';

import { useUiStore } from '../../stores/ui-store.js';

import { setupMonaco } from './monaco-setup.js';
import { themeForAppearance } from './monaco-theme.js';

/**
 * The Monaco diff editor — **wired but not yet fed by AI** (roadmap M2). This is the surface the
 * repair loop (M6) will present a proposed patch in: original on the left, proposed on the right,
 * side by side. Building it now, against real content, means M6 plugs a patch into an editor that
 * already works rather than integrating Monaco under deadline.
 *
 * Read-only on both sides for M2 (there is nothing to edit yet), same CSP-safe Monaco setup as the
 * code editor (no `unsafe-eval`, local workers), same token theme.
 */
/** Below this pane width the diff renders inline instead of as two columns. */
const SIDE_BY_SIDE_MIN_WIDTH = 720;

export function DiffEditor({
  original,
  modified,
  language,
}: {
  original: string;
  modified: string;
  language: string | null;
}): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    const el = container.current;
    if (el === null) return;
    const m = setupMonaco();
    const editor = m.editor.createDiffEditor(el, {
      readOnly: true,
      originalEditable: false,
      theme: themeForAppearance(useUiStore.getState().theme),
      automaticLayout: true,
      renderSideBySide: true,
      // The repair preview lives in the AI pane, which is 26% of the window by default and can be
      // dragged to 240px. Two code columns plus a gutter do not fit in that: side-by-side at this
      // width gives each side ~100px, which is a column of ellipses, not a diff. So fall back to
      // the inline view when the pane is narrow — the same thing VS Code does, and the reason its
      // diffs stay readable in a sidebar. Above the breakpoint the side-by-side view is restored.
      useInlineViewWhenSpaceIsLimited: true,
      renderSideBySideInlineBreakpoint: SIDE_BY_SIDE_MIN_WIDTH,
      ignoreTrimWhitespace: false,
      // 13px was the app-chrome size applied to code in a pane where code is the content.
      // The diff is the artifact under review; it gets the editor's reading size, not a caption's.
      fontSize: 13.5,
      lineHeight: 20,
      minimap: { enabled: false },
      renderOverviewRuler: false,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      scrollBeyondLastLine: false,
      // Without this the diff's own horizontal scrollbar is the only way to read a long line, and
      // in a narrow pane that means every line.
      wordWrap: 'on',
    });
    editorRef.current = editor;
    return () => {
      const models = editor.getModel();
      editor.dispose();
      models?.original.dispose();
      models?.modified.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null) return;
    const m = setupMonaco();
    const lang = language ?? 'plaintext';
    editor.getModel()?.original.dispose();
    editor.getModel()?.modified.dispose();
    editor.setModel({
      original: m.editor.createModel(original, lang),
      modified: m.editor.createModel(modified, lang),
    });
  }, [original, modified, language]);

  useEffect(() => {
    setupMonaco().editor.setTheme(themeForAppearance(theme));
  }, [theme]);

  // min-w-0 + overflow-hidden: Monaco measures its container, so a container allowed to be sized by
  // its content would let the editor argue with the pane it lives in during a drag.
  return <div ref={container} className="h-full w-full min-w-0 overflow-hidden" />;
}
