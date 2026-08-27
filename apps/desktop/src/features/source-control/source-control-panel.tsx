import { Button, CloseIcon, GitBranchIcon, RefreshIcon, Skeleton } from '@fixora/ui';
import { useEffect, useRef, useState } from 'react';

import { invoke } from '../../lib/bridge.js';
import { basename } from '../../lib/path.js';
import { useAiStore } from '../../stores/ai-store.js';
import { DiffEditor } from '../editor/diff-editor.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

type GitStatus = {
  branch: string | null;
  staged: { path: string; status: string }[];
  unstaged: { path: string; status: string }[];
};

type DiffResult = { original: string; modified: string; language: string };
type SelectedDiffFile = { relPath: string; staged: boolean };

/**
 * Source Control tab: `git status`/`add`/`restore --staged`/`commit`, shelling out to the user's
 * own `git` (git-service.ts) — Fixora does not vendor or reimplement any of it. No repository, or
 * no `git` on PATH, both resolve to an empty status rather than an error (the same best-effort
 * posture `editor:gitBlame` already established for the same reason).
 */
export function SourceControlPanel(): React.JSX.Element {
  const hasWorkspace = useWorkspaceStore((s) => s.workspace !== null);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDiffFile, setSelectedDiffFile] = useState<SelectedDiffFile | null>(null);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  // Throttled to at most one `git status` per 2s: stage/unstage each call refresh(), and clicking
  // through several files in quick succession must not fire one shell-out per click.
  const lastRunRef = useRef(0);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = (): void => {
    const runNow = (): void => {
      // An AI repair in flight is main-process work of its own — defer rather than add a `git`
      // shell-out to the same window; retry shortly instead of dropping the refresh entirely.
      if (useAiStore.getState().status === 'running') {
        if (pendingRef.current !== null) clearTimeout(pendingRef.current);
        pendingRef.current = setTimeout(runNow, 2000);
        return;
      }
      lastRunRef.current = Date.now();
      performance.mark('git-status-fetch-start');
      void invoke('git:status', {}).then((result) => {
        performance.mark('git-status-fetch-end');
        performance.measure('git-status-fetch', 'git-status-fetch-start', 'git-status-fetch-end');
        if (result.ok) setStatus(result.value);
      });
    };
    const elapsed = Date.now() - lastRunRef.current;
    if (elapsed >= 2000) {
      runNow();
      return;
    }
    if (pendingRef.current !== null) clearTimeout(pendingRef.current);
    pendingRef.current = setTimeout(runNow, 2000 - elapsed);
  };

  useEffect(() => {
    if (hasWorkspace) refresh();
    else setStatus(null);
  }, [hasWorkspace]);

  const stage = (relPath: string): void => {
    void invoke('git:stage', { relPath }).then(refresh);
  };
  const unstage = (relPath: string): void => {
    void invoke('git:unstage', { relPath }).then(refresh);
  };

  const openDiff = (relPath: string, staged: boolean): void => {
    setSelectedDiffFile({ relPath, staged });
    setDiffResult(null);
    setDiffError(null);
    setDiffLoading(true);
    void invoke('git:diff', { relPath, staged }).then((result) => {
      setDiffLoading(false);
      if (!result.ok) {
        setDiffError(result.error.message);
        return;
      }
      if ('error' in result.value) {
        setDiffError(result.value.error);
        return;
      }
      setDiffResult(result.value);
    });
  };
  const closeDiff = (): void => {
    setSelectedDiffFile(null);
    setDiffResult(null);
    setDiffError(null);
  };

  const commit = (): void => {
    if (message.trim() === '') return;
    setBusy(true);
    setError(null);
    void invoke('git:commit', { message: message.trim() }).then((result) => {
      setBusy(false);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setMessage('');
      refresh();
    });
  };

  if (!hasWorkspace) {
    return <Centered text="Open a folder to see its source control status" />;
  }
  if (status === null) {
    return <Centered text="Loading…" />;
  }
  if (status.branch === null) {
    return <Centered text="Not a git repository (or git is not installed)" />;
  }

  return (
    <section
      aria-label="Source Control"
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-raised"
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border-subtle px-3">
        <GitBranchIcon className="size-3.5 shrink-0 text-fg-muted" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wider text-fg-secondary">
          {status.branch}
        </span>
        <button
          type="button"
          onClick={refresh}
          title="Refresh"
          aria-label="Refresh"
          className="shrink-0 rounded p-1 text-fg-muted hover:bg-hover hover:text-fg"
        >
          <RefreshIcon className="size-3.5" />
        </button>
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border-subtle p-2">
        <textarea
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
          }}
          placeholder="Commit message"
          rows={2}
          className="w-full resize-none rounded border border-border-strong bg-inset px-2 py-1.5 text-xs text-fg outline-none placeholder:text-fg-muted focus-visible:outline-2 focus-visible:outline-focus-ring"
        />
        <Button
          variant="primary"
          size="sm"
          disabled={message.trim() === '' || status.staged.length === 0 || busy}
          onClick={commit}
        >
          {busy ? 'Committing…' : `Commit${status.staged.length > 0 ? ` (${String(status.staged.length)})` : ''}`}
        </Button>
        {error !== null && (
          <p role="alert" className="text-[11px] text-danger-text [overflow-wrap:anywhere]">
            {error}
          </p>
        )}
      </div>

      <div
        className={
          selectedDiffFile === null
            ? 'min-h-0 flex-1 overflow-y-auto'
            : 'min-h-[40%] shrink-0 overflow-y-auto'
        }
      >
        <FileGroup
          title="Staged Changes"
          files={status.staged}
          action="Unstage"
          onAction={unstage}
          staged
          onSelectDiff={openDiff}
        />
        <FileGroup
          title="Changes"
          files={status.unstaged}
          action="Stage"
          onAction={stage}
          staged={false}
          onSelectDiff={openDiff}
        />
        {status.staged.length === 0 && status.unstaged.length === 0 && (
          <Centered text="No changes" compact />
        )}
      </div>

      {selectedDiffFile !== null && (
        <div className="flex min-h-0 flex-1 flex-col border-t border-border-subtle">
          <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3">
            <span className="min-w-0 truncate text-[11px] text-fg-secondary" title={selectedDiffFile.relPath}>
              {basename(selectedDiffFile.relPath)}
            </span>
            <button
              type="button"
              onClick={closeDiff}
              aria-label="Close diff"
              title="Close diff"
              className="shrink-0 rounded p-0.5 text-fg-muted hover:bg-hover hover:text-fg"
            >
              <CloseIcon className="size-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {diffLoading ? (
              <div className="flex h-full flex-col gap-2 p-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : diffError !== null ? (
              <Centered text={diffError} compact />
            ) : diffResult !== null ? (
              <DiffEditor
                original={diffResult.original}
                modified={diffResult.modified}
                language={diffResult.language}
                startLine={1}
              />
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

function FileGroup({
  title,
  files,
  action,
  onAction,
  staged,
  onSelectDiff,
}: {
  title: string;
  files: { path: string; status: string }[];
  action: string;
  onAction: (relPath: string) => void;
  staged: boolean;
  onSelectDiff: (relPath: string, staged: boolean) => void;
}): React.JSX.Element | null {
  if (files.length === 0) return null;
  return (
    <div>
      <p className="border-b border-border-subtle bg-inset px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
        {title} ({files.length})
      </p>
      {files.map((f) => (
        <div
          key={f.path}
          role="button"
          tabIndex={0}
          onClick={() => {
            onSelectDiff(f.path, staged);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectDiff(f.path, staged);
            }
          }}
          className="group flex cursor-pointer items-center gap-2 border-b border-border-subtle px-3 py-1.5 hover:bg-hover"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-fg" title={f.path}>
              {basename(f.path)}
            </p>
            <p className="truncate text-[10px] text-fg-muted">
              {f.status} · {f.path}
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAction(f.path);
            }}
            className="shrink-0 rounded border border-border-subtle px-1.5 py-0.5 text-[10px] text-fg-secondary opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100"
          >
            {action}
          </button>
        </div>
      ))}
    </div>
  );
}

function Centered({ text, compact = false }: { text: string; compact?: boolean }): React.JSX.Element {
  return (
    <div
      role="status"
      className={`flex ${compact ? 'py-6' : 'h-full'} items-center justify-center p-6 text-center text-xs text-fg-muted`}
    >
      {text}
    </div>
  );
}
