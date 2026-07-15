import { WinCloseIcon, cn } from '@fixora/ui';
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
export function EditorArea(): React.JSX.Element {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTab = useEditorStore((s) => s.activeTab);
  const setActive = useEditorStore((s) => s.setActive);
  const closeTab = useEditorStore((s) => s.closeTab);

  // A file selected in the tree opens a tab here. This is the one cross-slice link, made explicit.
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
        className="flex h-full items-center justify-center bg-inset text-sm text-fg-muted"
      >
        Select a file to view it
      </section>
    );
  }

  return (
    <section aria-label="Editor" className="flex h-full flex-col bg-inset">
      <div
        role="tablist"
        aria-label="Open files"
        className="flex h-8 shrink-0 items-stretch overflow-x-auto border-b border-border-subtle bg-canvas"
      >
        {tabs.map((tab) => (
          <div
            key={tab.relPath}
            className={cn(
              'group flex items-center gap-1 border-r border-border-subtle pl-3 pr-1 text-xs',
              tab.relPath === activeTab ? 'bg-inset text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab.relPath === activeTab}
              onClick={() => {
                setActive(tab.relPath);
              }}
              className="max-w-40 truncate py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline"
              title={tab.relPath}
            >
              {tab.name}
            </button>
            <button
              type="button"
              aria-label={`Close ${tab.name}`}
              onClick={() => {
                disposeModel(tab.relPath);
                closeTab(tab.relPath);
              }}
              className="rounded-sm p-0.5 text-fg-muted opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
            >
              <WinCloseIcon className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {activeTab !== null && <ActiveFile key={activeTab} relPath={activeTab} />}
      </div>
    </section>
  );
}

/**
 * Fetches one file's content and renders the editor for it. A separate component (keyed by relPath)
 * so switching tabs unmounts the previous fetch state cleanly. The Monaco *model* is cached across
 * mounts, so re-activating a tab does not re-read the file.
 */
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
        className="flex h-full items-center justify-center p-6 text-center text-sm text-danger-text"
      >
        {state.message}
      </div>
    );
  }
  return <CodeEditor relPath={relPath} content={state.content} language={state.language} />;
}
