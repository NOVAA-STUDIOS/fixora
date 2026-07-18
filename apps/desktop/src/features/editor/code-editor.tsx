import type * as monaco from 'monaco-editor';
import { useEffect, useRef } from 'react';

import { useUiStore } from '../../stores/ui-store.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { modelFor } from './models.js';
import { setupMonaco } from './monaco-setup.js';
import { themeForAppearance } from './monaco-theme.js';

/**
 * A single Monaco editor instance that swaps which model it shows as the active tab changes. One
 * editor, many models (one per open file) — mounting a fresh editor per tab would be wasteful and
 * would drop view state. Read-only for M2: Fixora is a code *viewer* here; editing and patched
 * writes are M6, and there is no save path yet, so the editor must not imply one.
 */
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

  // Mount the editor once.
  useEffect(() => {
    const el = container.current;
    if (el === null) return;
    const monaco = setupMonaco();
    const editor = monaco.editor.create(el, {
      readOnly: true,
      theme: themeForAppearance(useUiStore.getState().theme),
      automaticLayout: true,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--fx-font-mono'),
      fontSize: 13,
      renderWhitespace: 'selection',
    });
    editorRef.current = editor;
    return () => {
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  // Point the editor at the active file's model whenever the active file or its content changes.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null) return;
    const monaco = setupMonaco();
    editor.setModel(modelFor(monaco, relPath, content, language));
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

  return <div ref={container} className="h-full w-full" />;
}
