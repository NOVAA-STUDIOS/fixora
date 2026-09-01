import type { PackageDependency, PackageSearchResult } from '@fixora/shared-types';
import { Button, PackageIcon, RefreshIcon, SearchIcon, VirtualList } from '@fixora/ui';
import { useEffect, useRef, useState } from 'react';

import { invoke } from '../../lib/bridge.js';
import { useTerminalStore } from '../terminal/terminal-store.js';
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

/** The install/uninstall commands above always say `npm`/`pip` explicitly (the manifest kind
 *  those already gate on); a task can be any script name, so its run command needs the actual
 *  package manager the project uses — `tasks:list`'s own `packageManager` field. */
function runScriptCommand(pm: 'npm' | 'pnpm' | 'yarn', name: string): string {
  return `${pm} run ${name}`;
}

export function PackagesPanel(): React.JSX.Element {
  const hasWorkspace = useWorkspaceStore((s) => s.workspace !== null);
  const openWithCommand = useTerminalStore((s) => s.openWithCommand);
  const [tab, setTab] = useState<'packages' | 'scripts'>('packages');

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

  const [scripts, setScripts] = useState<
    | { status: 'loading' }
    | { status: 'ready'; scripts: Record<string, string>; packageManager: 'npm' | 'pnpm' | 'yarn' }
  >({ status: 'loading' });

  const refreshScripts = (): void => {
    setScripts({ status: 'loading' });
    void invoke('tasks:list', {}).then((result) => {
      if (result.ok) {
        setScripts({
          status: 'ready',
          scripts: result.value.scripts,
          packageManager: result.value.packageManager,
        });
      }
    });
  };

  useEffect(() => {
    if (hasWorkspace) {
      refresh();
      refreshScripts();
    } else {
      setList({ status: 'loading' });
      setScripts({ status: 'loading' });
    }
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
      <div role="tablist" aria-label="Packages or Scripts" className="flex h-9 shrink-0 items-center gap-1 border-b border-border-subtle px-2">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'packages'}
          onClick={() => {
            setTab('packages');
          }}
          className={`rounded px-2 py-1 text-xs font-medium ${tab === 'packages' ? 'bg-hover text-fg' : 'text-fg-muted hover:text-fg'}`}
        >
          Packages
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'scripts'}
          onClick={() => {
            setTab('scripts');
          }}
          className={`rounded px-2 py-1 text-xs font-medium ${tab === 'scripts' ? 'bg-hover text-fg' : 'text-fg-muted hover:text-fg'}`}
        >
          Scripts
        </button>
      </div>

      {tab === 'scripts' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {scripts.status === 'loading' && <Centered text="Loading scripts…" />}
          {scripts.status === 'ready' && Object.keys(scripts.scripts).length === 0 && (
            <Centered text="No scripts found in package.json" />
          )}
          {scripts.status === 'ready' &&
            Object.entries(scripts.scripts).map(([name, command]) => (
              <div
                key={name}
                className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-hover"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium text-fg">{name}</span>
                  <span className="ml-2 truncate text-xs text-fg-muted">{command}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    openWithCommand(runScriptCommand(scripts.packageManager, name));
                  }}
                  className="shrink-0 rounded-md bg-accent/10 px-3 py-1 text-xs text-accent-text transition-colors hover:bg-accent/20"
                >
                  ▶ Run
                </button>
              </div>
            ))}
        </div>
      ) : (
        <>
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
                    openWithCommand(installCommand(kind, r.name, false));
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
                    openWithCommand(uninstallCommand(kind, d.name));
                  }}
                >
                  Uninstall
                </Button>
              </div>
            )}
          />
        )}
      </div>
        </>
      )}
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
