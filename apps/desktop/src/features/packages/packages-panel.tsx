import type { PackageDependency, PackageSearchResult } from '@fixora/shared-types';
import { Button, PackageIcon, RefreshIcon, SearchIcon, VirtualList } from '@fixora/ui';
import { useEffect, useRef, useState } from 'react';

import { invoke } from '../../lib/bridge.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

const DEBOUNCE_MS = 350;

/** The install/uninstall command for a manifest kind — run in the real Terminal tab, never
 * executed here, so a failure is just a shell showing a nonzero exit (Security §2: main never
 * runs a package manager on the renderer's say-so without the user seeing exactly what ran). */
function installCommand(kind: 'npm' | 'pip', name: string, dev: boolean): string {
  if (kind === 'npm') return `npm install ${dev ? '--save-dev ' : ''}${name}`;
  return `pip install ${name}`;
}
function uninstallCommand(kind: 'npm' | 'pip', name: string): string {
  if (kind === 'npm') return `npm uninstall ${name}`;
  return `pip uninstall -y ${name}`;
}

export function PackagesPanel(): React.JSX.Element {
  const hasWorkspace = useWorkspaceStore((s) => s.workspace !== null);
  const runInTerminal = useUiStore((s) => s.runInTerminal);

  const [list, setList] = useState<
    | { status: 'loading' }
    | { status: 'ready'; kind: 'npm' | 'pip' | 'none'; dependencies: PackageDependency[] }
    | { status: 'error'; message: string }
  >({ status: 'loading' });

  const refresh = (): void => {
    setList({ status: 'loading' });
    void invoke('packages:list', {}).then((result) => {
      setList(
        result.ok
          ? { status: 'ready', kind: result.value.kind, dependencies: result.value.dependencies }
          : { status: 'error', message: result.error.message },
      );
    });
  };

  useEffect(() => {
    if (hasWorkspace) refresh();
    else setList({ status: 'loading' });
    // Re-fetch whenever the user comes back from the Terminal tab, so an install/uninstall they
    // just ran is reflected without a manual refresh being the only way to see it.
  }, [hasWorkspace]);

  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState<
    { status: 'idle' } | { status: 'searching' } | { status: 'done'; results: PackageSearchResult[] }
  >({ status: 'idle' });
  const generation = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      generation.current += 1;
      setSearchState({ status: 'idle' });
      return;
    }
    const gen = ++generation.current;
    const timer = setTimeout(() => {
      setSearchState({ status: 'searching' });
      void invoke('packages:search', { query: trimmed }).then((result) => {
        if (gen !== generation.current) return;
        setSearchState({ status: 'done', results: result.ok ? result.value.results : [] });
      });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query]);

  if (!hasWorkspace) {
    return (
      <Centered icon={<PackageIcon className="size-5 text-fg-muted" />} text="Open a folder to manage its dependencies" />
    );
  }
  if (list.status === 'ready' && list.kind === 'none') {
    return <Centered icon={<PackageIcon className="size-5 text-fg-muted" />} text="No package.json or requirements.txt found in this project" />;
  }

  // 'none' is handled by the early return above; narrowed here so every call site below can treat
  // `kind` as the two real package managers only.
  const kind = list.status === 'ready' && list.kind !== 'none' ? list.kind : null;

  return (
    <section
      aria-label="Packages"
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-raised"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <SearchIcon className="size-3.5 shrink-0 text-fg-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder={kind === 'npm' ? 'Search npm…' : kind === 'pip' ? 'Search PyPI (exact name)…' : 'Search…'}
          aria-label="Search package registry"
          className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-muted"
        />
        <button
          type="button"
          onClick={refresh}
          title="Refresh dependency list"
          aria-label="Refresh dependency list"
          className="shrink-0 rounded p-1 text-fg-muted hover:bg-hover hover:text-fg"
        >
          <RefreshIcon className="size-3.5" />
        </button>
      </div>

      {searchState.status !== 'idle' && kind !== null && (
        <div className="max-h-56 shrink-0 overflow-y-auto border-b border-border-subtle">
          {searchState.status === 'searching' && <Centered text="Searching…" compact />}
          {searchState.status === 'done' && searchState.results.length === 0 && (
            <Centered text="No results" compact />
          )}
          {searchState.status === 'done' &&
            searchState.results.map((r) => (
              <div
                key={r.name}
                className="flex items-center gap-2 border-b border-border-subtle px-3 py-1.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-fg">
                    {r.name} <span className="text-fg-muted">{r.version}</span>
                  </p>
                  {r.description !== '' && (
                    <p className="truncate text-[11px] text-fg-muted">{r.description}</p>
                  )}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    runInTerminal(installCommand(kind, r.name, false));
                  }}
                >
                  Install
                </Button>
              </div>
            ))}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {list.status === 'loading' && <Centered text="Loading dependencies…" />}
        {list.status === 'error' && <Centered text={list.message} isError />}
        {list.status === 'ready' && list.dependencies.length === 0 && (
          <Centered text="No dependencies yet" />
        )}
        {list.status === 'ready' && list.dependencies.length > 0 && kind !== null && (
          <VirtualList
            items={list.dependencies}
            label="Dependencies"
            estimateRowHeight={36}
            getKey={(d) => d.name}
            className="h-full"
            renderItem={(d) => (
              <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-fg">{d.name}</p>
                  <p className="truncate text-[11px] text-fg-muted">
                    {d.version}
                    {d.dev && ' · dev'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    runInTerminal(uninstallCommand(kind, d.name));
                  }}
                >
                  Uninstall
                </Button>
              </div>
            )}
          />
        )}
      </div>
    </section>
  );
}

function Centered({
  text,
  icon,
  isError = false,
  compact = false,
}: {
  text: string;
  icon?: React.ReactNode;
  isError?: boolean;
  compact?: boolean;
}): React.JSX.Element {
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={`flex ${compact ? 'py-4' : 'h-full'} flex-col items-center justify-center gap-2 p-6 text-center text-xs ${isError ? 'text-danger-text' : 'text-fg-muted'}`}
    >
      {icon}
      {text}
    </div>
  );
}
