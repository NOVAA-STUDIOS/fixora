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
      ignoreTrimWhitespace: false,
      fontSize: 13,
      minimap: { enabled: false },
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

  return <div ref={container} className="h-full w-full" />;
}
