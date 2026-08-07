import { ConfirmDialog, FileIcon, WinCloseIcon, cn } from '@fixora/ui';
import { useEffect, useState } from 'react';

import { invoke } from '../../lib/bridge.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { CodeEditor } from './code-editor.js';
import { useEditorStore } from './editor-store.js';
import { disposeModel } from './models.js';

/**
 * The editor pane: a tab strip over one Monaco editor. Opening a file in the tree activates a tab
 * here; the content is fetched once through the guarded `fs:readFile` channel and handed to Monaco,
 * which owns it from then on (ADR-015). Closing a tab disposes its model so a large repo does not
 * accumulate every file ever opened in memory.
 */
/**
 * Tab icons, colour-coded by extension — the same generic file glyph the tree uses
 * (`file-tree.tsx`), tinted rather than swapped for a per-language icon set: distinguishing tabs
 * by colour at a glance is the useful part of "VS Code-like" tab icons; a full icon-per-language
 * asset library is a much larger, separate investment this does not attempt.
 */
const EXTENSION_COLOR: Record<string, string> = {
  ts: 'text-[#3178c6]',
  tsx: 'text-[#3178c6]',
  js: 'text-[#f1c40f]',
  jsx: 'text-[#f1c40f]',
  mjs: 'text-[#f1c40f]',
  cjs: 'text-[#f1c40f]',
  py: 'text-[#3572a5]',
  json: 'text-[#f1c40f]',
  css: 'text-[#42a5f5]',
  scss: 'text-[#c6538c]',
  html: 'text-[#e34c26]',
  md: 'text-fg-secondary',
  yml: 'text-[#cb171e]',
  yaml: 'text-[#cb171e]',
  go: 'text-[#00add8]',
  rs: 'text-[#dea584]',
};

function TabFileIcon({ name }: { name: string }): React.JSX.Element {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return (
    <FileIcon className={cn('size-3.5 shrink-0', EXTENSION_COLOR[ext] ?? 'text-fg-muted')} />
  );
}

export function EditorArea(): React.JSX.Element {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTab = useEditorStore((s) => s.activeTab);
  const setActive = useEditorStore((s) => s.setActive);
  const closeTab = useEditorStore((s) => s.closeTab);
  const dirty = useEditorStore((s) => s.dirty);
  const saveError = useEditorStore((s) => s.saveError);
  const saving = useEditorStore((s) => s.saving);
  const save = useEditorStore((s) => s.save);

  // A file selected in the tree opens a tab here. This is the one cross-slice link, made explicit.
  // The tab awaiting a close-without-saving decision, or null. Held here rather than resolved with
  // `window.confirm`, which paints an OS alert box in the middle of a designed product and blocks
  // the renderer thread while it is up.
  const [confirmClose, setConfirmClose] = useState<string | null>(null);

  const selectedFile = useWorkspaceStore((s) => s.selectedFile);
  const openFile = useEditorStore((s) => s.openFile);
  const treeNodes = useWorkspaceStore((s) => s.nodes);
  useEffect(() => {
    if (selectedFile === null) return;
    const node = treeNodes.find((n) => n.relPath === selectedFile);
    openFile(selectedFile, node?.language ?? null);
  }, [selectedFile, treeNodes, openFile]);

  if (tabs.length === 0) {
    return (
      <section
        aria-label="Editor"
        className="flex h-full flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-border-subtle bg-canvas p-6 text-center"
      >
        <p className="text-sm font-medium text-fg">No file open</p>
        <p className="max-w-sm text-xs text-fg-muted">
          Pick a file in <span className="text-fg-secondary">Files</span>, or click a finding in{' '}
          <span className="text-fg-secondary">Problems</span> to jump straight to the line
          it&rsquo;s on.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Editor"
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border-subtle bg-canvas"
    >
      {/* The strip is a scroller (the tabs) plus a pinned trailing island (Save). They used to be
          one flex row, which meant Save rode `ml-auto` *inside* the scrollable content: as soon as
          enough files were open to overflow, the only Save button scrolled off the right edge and
          could not be reached without scrolling the tabs away first. */}
      <div className="flex h-9 shrink-0 items-stretch border-b border-border-subtle bg-raised">
        <div
          role="tablist"
          aria-label="Open files"
          className="flex min-w-0 flex-1 items-stretch overflow-x-auto"
        >
          {tabs.map((tab) => {
            const isDirty = dirty.includes(tab.relPath);
            return (
              <div
                key={tab.relPath}
                className={cn(
                  // shrink-0: the strip scrolls horizontally, so tabs must keep their width rather
                  // than compressing every open file into an unreadable sliver as more are opened.
                  'group flex shrink-0 items-center gap-1 border-r border-border-subtle pl-3 pr-1 text-xs',
                  tab.relPath === activeTab
                    ? 'bg-canvas text-fg'
                    : 'text-fg-muted hover:bg-hover hover:text-fg',
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab.relPath === activeTab}
                  onClick={() => {
                    setActive(tab.relPath);
                  }}
                  className="flex min-w-0 max-w-40 items-center gap-1.5 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline"
                  title={isDirty ? `${tab.relPath} — unsaved changes` : tab.relPath}
                >
                  <TabFileIcon name={tab.name} />
                  <span className="min-w-0 truncate">{tab.name}</span>
                  {isDirty && (
                    <span
                      aria-label="Unsaved changes"
                      title="Unsaved changes — Ctrl+S to save"
                      className="size-1.5 shrink-0 rounded-full bg-accent"
                    />
                  )}
                </button>
                <button
                  type="button"
                  aria-label={`Close ${tab.name}`}
                  onClick={() => {
                    // Never discard unsaved work silently.
                    if (isDirty) {
                      setConfirmClose(tab.relPath);
                      return;
                    }
                    disposeModel(tab.relPath);
                    closeTab(tab.relPath);
                  }}
                  className="rounded-sm p-0.5 text-fg-muted opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
                >
                  <WinCloseIcon className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
        {/* An explicit Save, because Ctrl+S is muscle memory for some people and invisible to
            others. Disabled when there is nothing to save, so it also reports the file's state.
            Outside the scroller, so it stays put however many files are open. */}
        <div className="flex shrink-0 items-center gap-2 border-l border-border-subtle pr-2 pl-3">
          {saving !== null && <span className="text-[11px] text-fg-muted">Saving…</span>}
          <button
            type="button"
            disabled={activeTab === null || !dirty.includes(activeTab) || saving !== null}
            onClick={() => void save()}
            title={
              activeTab !== null && dirty.includes(activeTab)
                ? 'Save this file (Ctrl+S)'
                : 'No unsaved changes'
            }
            className="rounded border border-border-subtle px-2 py-0.5 text-[11px] text-fg-secondary hover:bg-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
          >
            Save
          </button>
        </div>
      </div>
      {saveError !== null && (
        <p
          role="alert"
          className="shrink-0 border-b border-border-subtle bg-danger-subtle px-3 py-1 text-xs text-danger-text [overflow-wrap:anywhere]"
        >
          {saveError}
        </p>
      )}
      {activeTab !== null && <Breadcrumbs relPath={activeTab} />}
      <div className="min-h-0 flex-1">
        {activeTab !== null && <ActiveFile key={activeTab} relPath={activeTab} />}
      </div>

      <ConfirmDialog
        open={confirmClose !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmClose(null);
        }}
        title="Close without saving?"
        description={`${confirmClose ?? ''} has unsaved changes. Closing this tab discards them.`}
        confirmLabel="Discard changes"
        onConfirm={() => {
          if (confirmClose === null) return;
          disposeModel(confirmClose);
          closeTab(confirmClose);
          setConfirmClose(null);
        }}
      />
    </section>
  );
}

/**
 * Fetches one file's content and renders the editor for it. A separate component (keyed by relPath)
 * so switching tabs unmounts the previous fetch state cleanly. The Monaco *model* is cached across
 * mounts, so re-activating a tab does not re-read the file.
 */
/**
 * Path-segment breadcrumbs above the editor. Deliberately scoped to the path only — a "current
 * function" segment (what VS Code's own breadcrumbs add via document symbols) needs a
 * DocumentSymbolProvider per language wired through Monaco and kept in sync with cursor position,
 * a materially bigger feature than a path display; noted here rather than left unmentioned so the
 * gap is a documented choice, not an oversight.
 */
function Breadcrumbs({ relPath }: { relPath: string }): React.JSX.Element {
  const segments = relPath.split('/').filter((s) => s !== '');
  return (
    <div
      aria-label="Breadcrumb"
      className="flex h-6 shrink-0 items-center gap-1 overflow-x-auto border-b border-border-subtle bg-raised px-3 text-[11px] text-fg-muted"
    >
      {segments.map((segment, i) => (
        <span key={`${segment}-${String(i)}`} className="flex shrink-0 items-center gap-1">
          {i > 0 && <span className="text-fg-muted/50">/</span>}
          <span className={i === segments.length - 1 ? 'text-fg-secondary' : undefined}>
            {segment}
          </span>
        </span>
      ))}
    </div>
  );
}

function ActiveFile({ relPath }: { relPath: string }): React.JSX.Element {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; content: string; language: string | null }
    | { status: 'error'; message: string }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    void invoke('fs:readFile', { relPath }).then((result) => {
      if (cancelled) return;
      setState(
        result.ok
          ? {
              status: 'ready',
              content: result.value.file.content,
              language: result.value.file.language,
            }
          : { status: 'error', message: result.error.message },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [relPath]);

  if (state.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-sm text-fg-muted">Loading…</div>
    );
  }
  if (state.status === 'error') {
    return (
      <div
        role="alert"
        className="flex h-full items-center justify-center p-6 text-center text-sm text-danger-text [overflow-wrap:anywhere]"
      >
        {state.message}
      </div>
    );
  }
  return <CodeEditor relPath={relPath} content={state.content} language={state.language} />;
}
