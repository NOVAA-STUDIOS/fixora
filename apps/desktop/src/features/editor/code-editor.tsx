import type * as monaco from 'monaco-editor';
import { useEffect, useRef, useState } from 'react';

import { useAiStore } from '../../stores/ai-store.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';


import { setActiveEditor } from './active-editor.js';
import { useEditorStore } from './editor-store.js';
import { InlineRepairBar } from './inline-repair-bar.js';
import { mountInlineRepair, type InlineRepairView } from './inline-repair.js';
import { modelFor } from './models.js';
import { setupMonaco } from './monaco-setup.js';
import { themeForAppearance } from './monaco-theme.js';

/**
 * A single Monaco editor instance that swaps which model it shows as the active tab changes. One
 * editor, many models (one per open file) — mounting a fresh editor per tab would be wasteful and
 * would drop view state.
 *
 * The editor is **editable**: a tool you fix code in has to let you type. Edits stay in the Monaco
 * model until saved (Ctrl/Cmd+S) through the guarded `fs:writeFile` channel; unsaved files are tracked
 * in the editor store so the tab shows a dot and closing one warns first. This is orthogonal to the
 * verified-repair flow, which still writes through its own path-guarded apply.
 */
/** Long enough that a pause mid-sentence does not write the file; short enough to feel automatic. */
const AUTO_SAVE_DEBOUNCE_MS = 1200;

/**
 * Below this editor width the minimap and the folding gutter are hidden.
 *
 * The editor pane can be dragged to 320px. A minimap is a fixed ~90px of that, so at narrow widths
 * it costs a third of the space meant for code to render an unreadable thumbnail of it. Monaco has
 * no built-in responsive rule for this, so the width is watched and the option toggled — which is
 * what VS Code itself does.
 */
const MINIMAP_MIN_WIDTH = 700;

export function CodeEditor({
  relPath,
  content,
  language,
}: {
  relPath: string;
  content: string;
  language: string | null;
}): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const theme = useUiStore((s) => s.theme);
  const revealTarget = useWorkspaceStore((s) => s.revealTarget);
  const proposal = useAiStore((s) => s.proposal);
  const inlineViewRef = useRef<InlineRepairView | null>(null);
  const [hunkPosition, setHunkPosition] = useState<{ index: number; total: number } | null>(null);

  // Mount the editor once.
  useEffect(() => {
    const el = container.current;
    if (el === null) return;
    const monaco = setupMonaco();
    const editor = monaco.editor.create(el, {
      // Editable: Fixora is a place you fix code, not only read it. Writes still go through the
      // guarded fs:writeFile channel, and unsaved edits are tracked so nothing is lost silently.
      readOnly: false,
      theme: themeForAppearance(useUiStore.getState().theme),
      automaticLayout: true,
      minimap: { enabled: el.clientWidth >= MINIMAP_MIN_WIDTH },
      scrollBeyondLastLine: false,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--fx-font-mono'),
      fontSize: 13,
      renderWhitespace: 'selection',
    });
    editorRef.current = editor;
    setActiveEditor(editor);

    // Ctrl/Cmd+S saves the file the editor is showing.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const model = editor.getModel();
      if (model === null) return;
      const path = decodeURI(model.uri.path).replace(/^\//, '');
      void useEditorStore.getState().save(path);
    });

    // Re-evaluate the minimap as the pane is dragged. `automaticLayout` re-lays-out the editor but
    // never revisits its options, so without this the minimap keeps whatever it was given at mount
    // and a pane dragged narrow stays two-thirds minimap. Guarded so a resize that does not cross
    // the threshold — i.e. almost every frame of a drag — does not touch Monaco at all.
    let minimapOn = el.clientWidth >= MINIMAP_MIN_WIDTH;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      const next = width >= MINIMAP_MIN_WIDTH;
      if (next === minimapOn) return;
      minimapOn = next;
      editor.updateOptions({ minimap: { enabled: next }, folding: next });
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      // Detach before teardown. Monaco's language services are worker-backed and asynchronous —
      // tokenization, links, folding — and each holds the model it was started against. Disposing
      // the editor while one is in flight leaves that request resolving into a torn-down editor,
      // which surfaces as an uncaught `Cancelled: Cancelled`. The model itself is cache-owned
      // (`models.ts`) and deliberately NOT disposed here.
      editor.setModel(null);
      editor.dispose();
      editorRef.current = null;
      setActiveEditor(null);
    };
  }, []);

  // Point the editor at the active file's model whenever the active file or its content changes,
  // and track unsaved edits so the tab can show a dot and closing can warn.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null) return;
    const monaco = setupMonaco();
    const model = modelFor(monaco, relPath, content, language);
    editor.setModel(model);
    let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
    const sub = model.onDidChangeContent(() => {
      useEditorStore.getState().syncDirty(relPath);

      // Auto-save (off by default, Settings). Debounced so it fires once after typing stops rather
      // than on every keystroke, and re-checked at fire time: the setting may have been turned off,
      // or the edit undone back to clean, in the second since the last keypress.
      if (!useUiStore.getState().autoSave) return;
      if (autoSaveTimer !== null) clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        autoSaveTimer = null;
        const editor = useEditorStore.getState();
        if (useUiStore.getState().autoSave && editor.isDirty(relPath)) void editor.save(relPath);
      }, AUTO_SAVE_DEBOUNCE_MS);
    });

    return () => {
      if (autoSaveTimer !== null) clearTimeout(autoSaveTimer);
      sub.dispose();
    };
  }, [relPath, content, language]);

  // Follow the app theme.
  useEffect(() => {
    setupMonaco().editor.setTheme(themeForAppearance(theme));
  }, [theme]);

  // Jump to + highlight a finding's range when this file is the reveal target (clicking a finding).
  // `token` is in the deps so re-clicking the same finding re-reveals it.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null) return;
    decorationsRef.current?.clear();
    if (revealTarget?.relPath !== relPath) return;

    const monaco = setupMonaco();
    const range = new monaco.Range(
      revealTarget.startLine,
      revealTarget.startCol,
      revealTarget.endLine,
      revealTarget.endCol,
    );
    editor.revealRangeInCenterIfOutsideViewport(range, monaco.editor.ScrollType.Smooth);
    editor.setPosition({ lineNumber: revealTarget.startLine, column: revealTarget.startCol });
    editor.focus(); // land the caret where the problem is, ready to edit
    decorationsRef.current = editor.createDecorationsCollection([
      {
        range: new monaco.Range(revealTarget.startLine, 1, revealTarget.endLine, 1),
        options: {
          isWholeLine: true,
          className: 'fx-finding-line',
          // A marker in the scrollbar too, so the line stays findable in a long file.
          overviewRuler: {
            color: '#8b5cf6',
            position: monaco.editor.OverviewRulerLane.Right,
          },
        },
      },
    ]);
  }, [revealTarget, relPath, content]);

  /**
   * The inline repair review (editor-first workflow).
   *
   * A proposal whose target is THIS file is drawn in place: the replaced lines are marked and the
   * proposed lines render beneath them, so review happens where the code is rather than in a panel
   * beside it. Torn down whenever the proposal, the file, or the content changes — a decoration left
   * behind after the model moves on would point at the wrong lines.
   *
   * Nothing here decides anything. Accept and Reject are wired to the same store actions the panel's
   * buttons used; the Apply gate, the verifier and the repair pipeline are untouched.
   */
  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null) return;
    if (proposal?.profile !== 'repair') return;
    if (proposal.target.file !== relPath) return;

    const view = mountInlineRepair({
      editor,
      monacoApi: setupMonaco(),
      originalCode: proposal.originalCode,
      repairedCode: proposal.repairedCode,
      startLine: proposal.target.startLine,
      endLine: proposal.target.endLine,
      onActiveHunkChange: (index, total) => {
        setHunkPosition({ index, total });
      },
    });
    inlineViewRef.current = view;
    setHunkPosition({ index: 0, total: view.hunkCount });

    return () => {
      view.dispose();
      inlineViewRef.current = null;
      setHunkPosition(null);
    };
  }, [proposal, relPath, content]);

  const showInlineReview =
    proposal !== null && proposal.profile === 'repair' && proposal.target.file === relPath;

  // min-w-0 + overflow-hidden: Monaco sizes itself from this container, so it must not be able to
  // be widened by its own content while the pane is being dragged narrower.
  return (
    <div className="relative h-full w-full min-w-0 overflow-hidden">
      <div ref={container} className="h-full w-full min-w-0 overflow-hidden" />
      {showInlineReview && (
        <InlineRepairBar
          position={hunkPosition}
          onNext={() => inlineViewRef.current?.next()}
          onPrevious={() => inlineViewRef.current?.previous()}
        />
      )}
    </div>
  );
}
