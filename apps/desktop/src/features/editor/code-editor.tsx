import type * as monaco from 'monaco-editor';
import { useEffect, useRef, useState } from 'react';

import { invoke } from '../../lib/bridge.js';
import { useAiStore } from '../../stores/ai-store.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useFindingsStore } from '../findings/findings-store.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { setActiveEditor } from './active-editor.js';
import { useEditorStatusStore } from './editor-status-store.js';
import { useEditorStore } from './editor-store.js';
import { InlineRepairBar } from './inline-repair-bar.js';
import { mountInlineRepair, type InlineRepairView } from './inline-repair.js';
import { modelFor } from './models.js';
import { setupMonaco } from './monaco-setup.js';
import { resolveEditorTheme } from './monaco-theme.js';

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
  const editorTheme = useUiStore((s) => s.editorTheme);
  const revealTarget = useWorkspaceStore((s) => s.revealTarget);
  const proposal = useAiStore((s) => s.proposal);
  // Changes on every analysis progress tick and on completion — the trigger to re-fetch this
  // file's own findings, independent of whatever severity filter the Problems panel currently has
  // active (unfiltered is the only correct answer for "what's wrong in the file I'm looking at").
  const findingsSummary = useFindingsStore((s) => s.summary);
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
      theme: resolveEditorTheme(useUiStore.getState().editorTheme, useUiStore.getState().theme),
      automaticLayout: true,
      minimap: { enabled: el.clientWidth >= MINIMAP_MIN_WIDTH },
      folding: el.clientWidth >= MINIMAP_MIN_WIDTH,
      scrollBeyondLastLine: false,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--fx-font-mono'),
      fontSize: 14,
      // VS Code's own editor gives the text room above/below the first and last line rather than
      // butting them against the pane edge.
      padding: { top: 8, bottom: 8 },
      renderWhitespace: 'selection',
      // The line the caret is on, highlighted in both the text and the gutter — Monaco's own
      // default ('line') only does the text; 'all' is what makes the current line findable at a
      // glance in a long file, which is the point of asking for it explicitly.
      renderLineHighlight: 'all',
      lineNumbers: 'on',
      // All of these are Monaco's own defaults already (the full `monaco-editor` bundle — see
      // monaco-setup.ts — registers bracket matching, auto-closing, auto-indent, multi-cursor and
      // the find/replace widget as standard contributions). Made explicit rather than left
      // implicit: a later change to Monaco's defaults, or to this options object, must not silently
      // turn one of these off.
      matchBrackets: 'always',
      autoClosingBrackets: 'always',
      autoClosingQuotes: 'always',
      autoIndent: 'full',
      multiCursorModifier: 'alt',
      quickSuggestions: true,
      suggestOnTriggerCharacters: true,
      // Suggestions drawn from words already in the open files, not just the active language
      // service's own completions — real for every language Monaco tokenizes, including ones
      // with no semantic worker (CSS/HTML/JSON have real language-service IntelliSense already,
      // via monaco-setup.ts's workers; Python and everything else get this word-based layer,
      // which is genuinely all Monaco itself can offer without an actual language server).
      wordBasedSuggestions: 'allDocuments',
      // The enclosing scope (function/class) pinned at the top while scrolling past it — Monaco's
      // own built-in contribution, driven by the same folding-range/outline data folding uses.
      stickyScroll: { enabled: true },
      // Hover docs, Go to Definition (F12) and Go to References (Shift+F12) are Monaco's own
      // standard contributions, explicit for the same reason as the options above. Real (type
      // info, cross-file navigation) for TS/JS/JSON/CSS/HTML, which have an actual language-service
      // worker (monaco-setup.ts); a language with none — Python included — has nothing for these to
      // query, the same ceiling `wordBasedSuggestions` documents above.
      hover: { enabled: true },
    });
    editorRef.current = editor;
    setActiveEditor(editor);

    const cursorSub = editor.onDidChangeCursorPosition((e) => {
      useEditorStatusStore.getState().setPosition(e.position.lineNumber, e.position.column);
    });

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
      cursorSub.dispose();
      useEditorStatusStore.getState().clear();
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
    useEditorStatusStore.getState().setLanguage(language);
    const pos = editor.getPosition();
    if (pos !== null) useEditorStatusStore.getState().setPosition(pos.lineNumber, pos.column);
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

  // Follow the app theme (for 'fixora') and the editor theme setting (for a named theme, which
  // stays fixed regardless of the app's own light/dark toggle).
  useEffect(() => {
    setupMonaco().editor.setTheme(resolveEditorTheme(editorTheme, theme));
  }, [theme, editorTheme]);

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
   * Error squiggles: every current finding in this file, drawn as a Monaco marker (red/yellow/blue
   * underline, hover tooltip with the message — Monaco's own rendering, not a custom decoration).
   * Queried directly with `{ relPath }` rather than read from the findings store's own `findings`
   * array, because that array reflects whatever severity filter the Problems panel currently has
   * active — the editor must show every problem in the open file regardless of what the panel is
   * filtered to. `findingsSummary` is the trigger to re-run this: it changes on every analysis
   * progress tick and on completion, which is when the answer could have changed.
   */
  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null) return;
    let cancelled = false;
    // Same reasoning as file-tree.tsx's useFileSeverity: `findingsSummary` changes roughly every
    // 200ms during a burst of streaming findings, and with a split pane open this fetch runs
    // TWICE per tick (one CodeEditor instance per pane) — debounced so a long analysis run on a
    // large project does not fire a steady stream of IPC round-trips for its whole duration.
    const timer = setTimeout(() => {
      performance.mark('squiggle-fetch-start');
      void invoke('analysis:list', { filter: { relPath } }).then((result) => {
        performance.mark('squiggle-fetch-end');
        performance.measure('squiggle-fetch', 'squiggle-fetch-start', 'squiggle-fetch-end');
        if (cancelled || !result.ok) return;
        const model = editor.getModel();
        if (model === null) return;
        const monacoApi = setupMonaco();
        const severityOf = (s: string): monaco.MarkerSeverity =>
          s === 'error'
            ? monacoApi.MarkerSeverity.Error
            : s === 'warning'
              ? monacoApi.MarkerSeverity.Warning
              : monacoApi.MarkerSeverity.Info;
        monacoApi.editor.setModelMarkers(
          model,
          'fixora',
          result.value.findings.map((f) => ({
            severity: severityOf(f.severity),
            startLineNumber: f.location.startLine,
            startColumn: f.location.startCol,
            endLineNumber: f.location.endLine,
            endColumn: f.location.endCol,
            message: f.message,
            source: f.source,
          })),
        );
      });
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [relPath, findingsSummary]);

  /**
   * Git blame, current line only — the same scope VS Code's own built-in "current line blame"
   * uses, not GitLens's every-line-annotated mode. A decoration per line in a large file is a real
   * rendering cost for information almost never read on more than one line at a time; one
   * decoration that follows the caret gives the same answer ("who wrote this, and when") at a
   * fraction of the cost, and is exactly what `git-blame-service.ts` is scoped for (best-effort,
   * no error surfaced when there is nothing to show — a fresh file, an untracked one, or no git
   * repository at all are all silently empty rather than a banner).
   */
  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null) return;
    let cancelled = false;
    let blameByLine = new Map<number, { author: string; authorTimeUnix: number; summary: string }>();
    let blameDecorations: monaco.editor.IEditorDecorationsCollection | null = null;

    const paint = (): void => {
      const model = editor.getModel();
      if (model === null) return;
      const line = editor.getPosition()?.lineNumber;
      const blame = line === undefined ? undefined : blameByLine.get(line);
      blameDecorations ??= editor.createDecorationsCollection();
      if (blame === undefined) {
        blameDecorations.set([]);
        return;
      }
      const when = new Date(blame.authorTimeUnix * 1000).toLocaleDateString();
      blameDecorations.set([
        {
          range: new (setupMonaco().Range)(line ?? 1, Number.MAX_SAFE_INTEGER, line ?? 1, Number.MAX_SAFE_INTEGER),
          options: {
            after: {
              content: `  ${blame.author}, ${when} — ${blame.summary}`,
              inlineClassName: 'fx-blame-inline',
            },
          },
        },
      ]);
    };

    void invoke('editor:gitBlame', { relPath }).then((result) => {
      if (cancelled || !result.ok) return;
      blameByLine = new Map(result.value.lines.map((l) => [l.line, l]));
      paint();
    });

    const sub = editor.onDidChangeCursorPosition(paint);
    return () => {
      cancelled = true;
      sub.dispose();
      blameDecorations?.clear();
    };
  }, [relPath]);

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
