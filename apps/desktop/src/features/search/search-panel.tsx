import type { SearchMatch } from '@fixora/shared-types';
import { Button, ChevronDownIcon, ChevronRightIcon, ConfirmDialog, SearchIcon, VirtualList, cn } from '@fixora/ui';
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
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [fileFilter, setFileFilter] = useState('');
  const [replacement, setReplacement] = useState('');
  const [confirmReplaceAll, setConfirmReplaceAll] = useState(false);
  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'searching' }
    | { status: 'done'; matches: SearchMatch[]; truncated: boolean }
    | { status: 'error'; message: string }
  >({ status: 'idle' });
  const generation = useRef(0);

  const runSearch = (): void => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      generation.current += 1;
      setState({ status: 'idle' });
      return;
    }
    const gen = ++generation.current;
    setState({ status: 'searching' });
    void invoke('search:query', {
      query: trimmed,
      caseSensitive,
      useRegex,
      fileFilter: fileFilter.trim(),
    }).then((result) => {
      if (gen !== generation.current) return; // superseded by a later keystroke
      setState(
        result.ok
          ? { status: 'done', matches: result.value.matches, truncated: result.value.truncated }
          : { status: 'error', message: result.error.message },
      );
    });
  };

  useEffect(() => {
    const timer = setTimeout(runSearch, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, caseSensitive, useRegex, fileFilter]);

  const replaceOne = async (match: SearchMatch): Promise<void> => {
    await applyReplacements(match.file, [match], replacement);
    runSearch();
  };

  const replaceAll = async (): Promise<void> => {
    if (state.status !== 'done') return;
    const byFile = new Map<string, SearchMatch[]>();
    for (const m of state.matches) {
      const list = byFile.get(m.file) ?? [];
      list.push(m);
      byFile.set(m.file, list);
    }
    for (const [file, fileMatches] of byFile) {
      await applyReplacements(file, fileMatches, replacement);
    }
    runSearch();
  };

  return (
    <section
      aria-label="Search"
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-raised"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <button
          type="button"
          onClick={() => {
            setReplaceOpen((v) => !v);
          }}
          aria-label={replaceOpen ? 'Hide replace' : 'Show replace'}
          aria-expanded={replaceOpen}
          className="shrink-0 rounded p-0.5 text-fg-muted hover:bg-hover hover:text-fg"
        >
          {replaceOpen ? (
            <ChevronDownIcon className="size-3.5" />
          ) : (
            <ChevronRightIcon className="size-3.5" />
          )}
        </button>
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
        <ToggleButton
          label="Aa"
          title="Match case"
          active={caseSensitive}
          onClick={() => {
            setCaseSensitive((v) => !v);
          }}
        />
        <ToggleButton
          label=".*"
          title="Use regular expression"
          active={useRegex}
          onClick={() => {
            setUseRegex((v) => !v);
          }}
        />
      </div>

      {replaceOpen && (
        <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border-subtle px-3">
          <input
            type="text"
            value={replacement}
            onChange={(e) => {
              setReplacement(e.target.value);
            }}
            placeholder="Replace"
            aria-label="Replace with"
            className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-muted"
          />
          <button
            type="button"
            disabled={state.status !== 'done' || state.matches.length === 0}
            onClick={() => {
              setConfirmReplaceAll(true);
            }}
            className="shrink-0 rounded border border-border-subtle px-1.5 py-0.5 text-[10px] text-fg-secondary hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            Replace All
          </button>
        </div>
      )}

      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <input
          type="text"
          value={fileFilter}
          onChange={(e) => {
            setFileFilter(e.target.value);
          }}
          disabled={!hasWorkspace}
          placeholder="Files to include (e.g. *.ts, src/**)"
          aria-label="Files to include"
          className="min-w-0 flex-1 bg-transparent text-[11px] text-fg outline-none placeholder:text-fg-muted disabled:cursor-not-allowed"
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
            renderItem={(m) => (
              <MatchRow
                match={m}
                onOpen={() => {
                  openMatch(m, revealAt);
                }}
                showReplace={replaceOpen}
                onReplace={() => void replaceOne(m)}
              />
            )}
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmReplaceAll}
        onOpenChange={setConfirmReplaceAll}
        title="Replace all matches?"
        description={
          state.status === 'done'
            ? `This replaces ${String(state.matches.length)} match${state.matches.length === 1 ? '' : 'es'} and cannot be undone.`
            : 'This cannot be undone.'
        }
        confirmLabel="Replace All"
        onConfirm={() => void replaceAll()}
      />
    </section>
  );
}

/** Applies `replacement` at each match's exact line/column, bottom-to-top within the file so an
 *  earlier replacement's length change never shifts a later match's offset before it's applied. */
async function applyReplacements(
  file: string,
  fileMatches: readonly SearchMatch[],
  replacement: string,
): Promise<void> {
  const read = await invoke('fs:readFile', { relPath: file });
  if (!read.ok) return;
  const lines = read.value.file.content.split('\n');
  const sorted = [...fileMatches].sort((a, b) => b.line - a.line || b.column - a.column);
  for (const m of sorted) {
    const line = lines[m.line - 1];
    if (line === undefined) continue;
    const start = m.column - 1;
    lines[m.line - 1] = line.slice(0, start) + replacement + line.slice(start + m.matchLength);
  }
  await invoke('fs:writeWorkspaceFile', { relPath: file, content: lines.join('\n') });
}

function ToggleButton({
  label,
  title,
  active,
  onClick,
}: {
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'shrink-0 rounded px-1 py-0.5 text-[10px] font-medium',
        active ? 'bg-accent-subtle text-accent-text' : 'text-fg-muted hover:bg-hover hover:text-fg',
      )}
    >
      {label}
    </button>
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

function MatchRow({
  match,
  onOpen,
  showReplace,
  onReplace,
}: {
  match: SearchMatch;
  onOpen: () => void;
  showReplace: boolean;
  onReplace: () => void;
}): React.JSX.Element {
  return (
    <div className="group flex w-full min-w-0 items-start border-b border-border-subtle hover:bg-hover">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-3 py-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline"
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
      {showReplace && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 mr-2 shrink-0 self-start text-[10px]"
          onClick={onReplace}
        >
          Replace
        </Button>
      )}
    </div>
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
