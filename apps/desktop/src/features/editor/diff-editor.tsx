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
  startLine = 1,
  sideBySide,
  onLineClick,
}: {
  original: string;
  modified: string;
  language: string | null;
  /**
   * The real file line the patch starts at.
   *
   * Both models hold a SLICE of the file, so Monaco numbers them from 1 — which means a repair to
   * lines 120-140 displayed as "1-21", and every line number in the review surface was wrong. The
   * gutter is offset by this so it reads the file's own numbering.
   */
  startLine?: number;
  /** Force two columns / one column. Omitted means responsive: two columns only when they fit. */
  sideBySide?: boolean | undefined;
  /** Called with the REAL file line when a line in the diff is clicked. */
  onLineClick?: (fileLine: number) => void;
}): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const theme = useUiStore((s) => s.theme);
  // Read through refs inside Monaco's listeners: the editor is created once, so a callback captured
  // at creation would keep calling the first render's closure for the life of the component.
  const startLineRef = useRef(startLine);
  startLineRef.current = startLine;
  const onLineClickRef = useRef(onLineClick);
  onLineClickRef.current = onLineClick;

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
      // The gutter shows the file's real lines, not the slice's. Monaco accepts a formatter, which is
      // the only way to renumber without shipping the whole file into the model.
      lineNumbers: (n: number) => String(n + startLineRef.current - 1),
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

    // Click a line, land on it in the editor. Without this the diff is a picture of the change; with
    // it, it is a way into the code — which is what makes it a review surface rather than a preview.
    const clickable = editor.getModifiedEditor().onMouseDown((event) => {
      const line = event.target.position?.lineNumber;
      if (line === undefined) return;
      onLineClickRef.current?.(line + startLineRef.current - 1);
    });

    return () => {
      clickable.dispose();
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

  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null) return;
    // `undefined` hands control back to the responsive rule; a boolean pins it to the user's choice.
    editor.updateOptions(
      sideBySide === undefined
        ? { useInlineViewWhenSpaceIsLimited: true }
        : { renderSideBySide: sideBySide, useInlineViewWhenSpaceIsLimited: false },
    );
  }, [sideBySide]);

  // min-w-0 + overflow-hidden: Monaco measures its container, so a container allowed to be sized by
  // its content would let the editor argue with the pane it lives in during a drag.
  return <div ref={container} className="h-full w-full min-w-0 overflow-hidden" />;
}
