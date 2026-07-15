import type { WorkspaceInfo } from '@fixora/shared-types';
import { Button, FolderIcon } from '@fixora/ui';
import { useEffect, useState } from 'react';

import { invoke } from '../../lib/bridge.js';

import { FileTree } from './file-tree.js';
import { useWorkspaceStore } from './workspace-store.js';

/**
 * The primary panel's workspace surface. With no workspace open it offers "Open folder" and the
 * recent list; once a folder is open it shows the file tree. This is what makes the app "a
 * competent code viewer" (roadmap M2) — and it works fully offline and signed out (FR-1): opening a
 * folder and browsing it touches no network at all.
 */
export function WorkspacePanel(): React.JSX.Element {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const opening = useWorkspaceStore((s) => s.opening);
  const error = useWorkspaceStore((s) => s.error);
  const pickAndOpen = useWorkspaceStore((s) => s.pickAndOpen);

  if (workspace !== null) {
    return (
      <section
        aria-label="Workspace"
        className="flex h-full flex-col border-r border-border-subtle bg-canvas"
      >
        <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
          <FolderIcon className="size-4 shrink-0 text-fg-muted" />
          <span className="truncate text-xs font-semibold text-fg" title={workspace.rootPath}>
            {workspace.name}
          </span>
        </header>
        <div className="min-h-0 flex-1">
          <FileTree />
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Workspace"
      className="flex h-full flex-col items-center justify-center gap-4 border-r border-border-subtle bg-canvas p-6 text-center"
    >
      <div className="flex flex-col items-center gap-1">
        <FolderIcon className="size-8 text-fg-muted" />
        <h2 className="text-sm font-semibold text-fg">No folder open</h2>
        <p className="text-xs text-fg-muted">
          Open a repository to browse and read it — offline, no sign-in.
        </p>
      </div>
      <Button variant="primary" onClick={() => void pickAndOpen()} disabled={opening}>
        {opening ? 'Opening…' : 'Open folder'}
      </Button>
      {error !== null && (
        <p role="alert" className="max-w-xs text-xs text-danger-text">
          {error}
        </p>
      )}
      <RecentWorkspaces />
    </section>
  );
}

function RecentWorkspaces(): React.JSX.Element | null {
  const openPath = useWorkspaceStore((s) => s.openPath);
  const [recent, setRecent] = useState<WorkspaceInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    void invoke('workspace:recent', {}).then((result) => {
      if (!cancelled && result.ok) setRecent(result.value.workspaces);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (recent.length === 0) return null;

  return (
    <div className="flex w-full max-w-xs flex-col gap-1">
      <p className="text-xs font-medium text-fg-muted">Recent</p>
      {recent.map((w) => (
        <Button
          key={w.id}
          variant="ghost"
          size="sm"
          className="justify-start truncate"
          title={w.rootPath}
          onClick={() => void openPath(w.rootPath)}
        >
          {w.name}
        </Button>
      ))}
    </div>
  );
}
