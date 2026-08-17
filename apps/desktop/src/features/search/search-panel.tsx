import type { SearchMatch } from '@fixora/shared-types';
import { SearchIcon, VirtualList } from '@fixora/ui';
import { useEffect, useRef, useState } from 'react';

import { invoke } from '../../lib/bridge.js';
import { basename } from '../../lib/path.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

const DEBOUNCE_MS = 300;
/** Below this, every keystroke would fan out into a full-repo scan for almost no signal. */
const MIN_QUERY_LENGTH = 2;

/**
 * Full-text project search. Debounced input, one main-process request per settled query
 * (`search:query` — see search-service.ts for how it stays fast on a 100k+ file project: chunked,
 * capped, never all file content in memory at once). Results are virtualized the same way the
 * problems list and file tree are — a match list capped at a few hundred rows costs nothing to
 * render in full, but the pattern stays consistent app-wide rather than being a rendering choice
 * made per-surface.
 *
 * A generation counter, not a cancel channel: main's own request/response round trip is what a
 * fast retype would race, and the fix is "ignore the stale response", not "cancel the in-flight
 * scan" — simpler than analysis's cancellable-run machinery, and correct for a one-shot query.
 */
export function SearchPanel(): React.JSX.Element {
  const hasWorkspace = useWorkspaceStore((s) => s.workspace !== null);
  const revealAt = useWorkspaceStore((s) => s.revealAt);
  const [query, setQuery] = useState('');
  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'searching' }
    | { status: 'done'; matches: SearchMatch[]; truncated: boolean }
    | { status: 'error'; message: string }
  >({ status: 'idle' });
  const generation = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      generation.current += 1;
      setState({ status: 'idle' });
      return;
    }
    const gen = ++generation.current;
    const timer = setTimeout(() => {
      setState({ status: 'searching' });
      void invoke('search:query', { query: trimmed }).then((result) => {
        if (gen !== generation.current) return; // superseded by a later keystroke
        setState(
          result.ok
            ? { status: 'done', matches: result.value.matches, truncated: result.value.truncated }
            : { status: 'error', message: result.error.message },
        );
      });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <section
      aria-label="Search"
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
          disabled={!hasWorkspace}
          placeholder={hasWorkspace ? 'Search project files…' : 'Open a folder to search'}
          aria-label="Search project files"
          className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-muted disabled:cursor-not-allowed"
        />
      </div>

      {state.status === 'done' && state.matches.length > 0 && (
        <p className="shrink-0 border-b border-border-subtle bg-inset px-3 py-1.5 text-[11px] text-fg-muted">
          {state.matches.length} match{state.matches.length === 1 ? '' : 'es'}
          {state.truncated && ' — narrow your query to see the rest'}
        </p>
      )}

      <div className="min-h-0 flex-1">
        {state.status === 'idle' && (
          <Centered
            text={
              hasWorkspace
                ? `Type at least ${String(MIN_QUERY_LENGTH)} characters to search`
                : 'Open a folder, then search its files'
            }
          />
        )}
        {state.status === 'searching' && <Centered text="Searching…" />}
        {state.status === 'error' && <Centered text={state.message} isError />}
        {state.status === 'done' && state.matches.length === 0 && <Centered text="No matches" />}
        {state.status === 'done' && state.matches.length > 0 && (
          <VirtualList
            items={state.matches}
            label="Search results"
            estimateRowHeight={56}
            dynamicRowHeight
            getKey={(m, i) => `${m.file}:${String(m.line)}:${String(m.column)}:${String(i)}`}
            className="h-full"
            onActivate={(m) => {
              openMatch(m, revealAt);
            }}
            renderItem={(m) => <MatchRow match={m} onOpen={() => { openMatch(m, revealAt); }} />}
          />
        )}
      </div>
    </section>
  );
}

function openMatch(
  match: SearchMatch,
  revealAt: (location: {
    file: string;
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
    severity: 'error' | 'warning' | 'info';
  }) => void,
): void {
  revealAt({
    file: match.file,
    startLine: match.line,
    startCol: match.column,
    endLine: match.line,
    endCol: match.column + match.matchLength,
    // A text-search hit isn't a finding — 'info' just picks the least alarming highlight colour.
    severity: 'info',
  });
}

function Centered({ text, isError = false }: { text: string; isError?: boolean }): React.JSX.Element {
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={`flex h-full items-center justify-center p-6 text-center text-xs ${isError ? 'text-danger-text' : 'text-fg-muted'}`}
    >
      {text}
    </div>
  );
}

function MatchRow({ match, onOpen }: { match: SearchMatch; onOpen: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full min-w-0 flex-col items-start gap-0.5 border-b border-border-subtle px-3 py-2 text-left hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline"
    >
      <span className="flex w-full min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate font-mono text-[11px] text-fg-secondary">
          {basename(match.file)}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-fg-muted">:{match.line}</span>
      </span>
      {match.contextBefore.map((line, i) => (
        <ContextLine key={`b${String(i)}`} text={line} />
      ))}
      <span className="w-full truncate font-mono text-[11px] text-fg">
        <Highlighted line={match.lineText} column={match.column} length={match.matchLength} />
      </span>
      {match.contextAfter.map((line, i) => (
        <ContextLine key={`a${String(i)}`} text={line} />
      ))}
    </button>
  );
}

function ContextLine({ text }: { text: string }): React.JSX.Element {
  return <span className="w-full truncate font-mono text-[11px] text-fg-muted">{text}</span>;
}

/** The match substring highlighted within its line — `column` is 1-based (Monaco convention). */
function Highlighted({
  line,
  column,
  length,
}: {
  line: string;
  column: number;
  length: number;
}): React.JSX.Element {
  const start = column - 1;
  const end = start + length;
  return (
    <>
      {line.slice(0, start)}
      <mark className="rounded-sm bg-accent-subtle text-accent-text">{line.slice(start, end)}</mark>
      {line.slice(end)}
    </>
  );
}
