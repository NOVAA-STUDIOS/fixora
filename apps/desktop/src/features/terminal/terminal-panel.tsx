import '@xterm/xterm/css/xterm.css';

import { ChevronDownIcon, PlusIcon, SearchIcon, TerminalIcon, WinCloseIcon, cn } from '@fixora/ui';
import { CanvasAddon } from '@xterm/addon-canvas';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal as XTerm, type ITheme } from '@xterm/xterm';
import { memo, useEffect, useRef, useState } from 'react';

import { invoke, subscribe } from '../../lib/bridge.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { useTerminalStore, type TerminalSession } from './terminal-store.js';

type ShellOption = { id: string; label: string; command: string; args: string[] };

/**
 * xterm needs concrete hex, not CSS variables or the app's design tokens — a shell prompt commonly
 * prints in plain ANSI white/black (`\x1b[37m`, `\x1b[30m`) regardless of the app's theme, and
 * xterm's own default ANSI palette is tuned for a dark background. Without an explicit palette here,
 * switching to Light left prompt text painted in near-white on a near-white background — invisible,
 * not just low-contrast. Every ANSI slot is set for both themes so no code path can hit an
 * unstyled default. Yellow is pinned to the same #e5c07b in both themes on request.
 */
const DARK_THEME: ITheme = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#808080',
  black: '#1e1e1e',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#d4d4d4',
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff',
};

const LIGHT_THEME: ITheme = {
  background: '#f5f5f5',
  foreground: '#1e1e1e',
  cursor: '#808080',
  black: '#1e1e1e',
  red: '#b3272d',
  green: '#3a7a2e',
  yellow: '#e5c07b',
  blue: '#2464b4',
  magenta: '#9331a8',
  cyan: '#1a8a94',
  white: '#3a3a3a',
  brightBlack: '#6b6b6b',
  brightRed: '#b3272d',
  brightGreen: '#3a7a2e',
  brightYellow: '#e5c07b',
  brightBlue: '#2464b4',
  brightMagenta: '#9331a8',
  brightCyan: '#1a8a94',
  brightWhite: '#1e1e1e',
};

function xtermTheme(appearance: 'dark' | 'light'): ITheme {
  return appearance === 'dark' ? DARK_THEME : LIGHT_THEME;
}

/**
 * The integrated terminal (Terminal tab, activity rail; also `Workbench`'s always-mounted sibling
 * — see its own doc comment for why). A tab strip over several persistent sessions, VS Code-style:
 * switching tabs hides/shows a session's pane via CSS rather than unmounting it, so a background
 * shell's output keeps accumulating and a running command keeps running while another tab — or
 * another activity view entirely — is in view. Each `TerminalInstance` owns exactly one `node-pty`
 * session and exactly one xterm instance for its whole lifetime.
 */
export function TerminalPanel(): React.JSX.Element {
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id ?? null);
  const isVisible = useUiStore((s) => s.activeView === 'terminal');
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeId);
  const splitId = useTerminalStore((s) => s.splitId);
  const addSession = useTerminalStore((s) => s.addSession);
  const closeSession = useTerminalStore((s) => s.closeSession);
  const setActive = useTerminalStore((s) => s.setActive);
  const setSplit = useTerminalStore((s) => s.setSplit);

  const [shells, setShells] = useState<ShellOption[]>([]);
  useEffect(() => {
    void invoke('terminal:listShells', {}).then((result) => {
      if (result.ok) setShells(result.value.shells);
    });
  }, []);

  const [shellMenuOpen, setShellMenuOpen] = useState(false);

  // The first tab, once — created the first time the panel actually becomes visible (not eagerly
  // the moment a workspace opens: TerminalPanel is now always mounted, per Workbench's own doc
  // comment, so "first visible" is the right trigger for "a terminal is worth having open").
  useEffect(() => {
    if (workspaceId !== null && isVisible && sessions.length === 0) addSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, isVisible]);

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-canvas">
      <div className="flex h-9 shrink-0 items-stretch border-b border-border-subtle bg-raised">
        <div role="tablist" aria-label="Terminals" className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {sessions.map((session) => (
            <TerminalTab
              key={session.id}
              session={session}
              active={session.id === activeId}
              onSelect={() => {
                setActive(session.id);
              }}
              onClose={() => {
                closeSession(session.id);
              }}
              onSplit={() => {
                setSplit(splitId === session.id ? null : session.id);
              }}
            />
          ))}
        </div>
        <div className="relative flex shrink-0 items-stretch border-l border-border-subtle">
          <button
            type="button"
            aria-label="New terminal"
            title="New terminal"
            onClick={() => {
              addSession();
            }}
            className="flex items-center px-2 text-fg-muted hover:bg-hover hover:text-fg"
          >
            <PlusIcon className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Choose shell"
            aria-haspopup="menu"
            aria-expanded={shellMenuOpen}
            title="New terminal with a specific shell"
            onClick={() => {
              setShellMenuOpen((v) => !v);
            }}
            className="flex items-center px-1 text-fg-muted hover:bg-hover hover:text-fg"
          >
            <ChevronDownIcon className="size-3" />
          </button>
          {shellMenuOpen && (
            <>
              <button
                type="button"
                aria-hidden="true"
                tabIndex={-1}
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => {
                  setShellMenuOpen(false);
                }}
              />
              <div
                role="menu"
                aria-label="Available shells"
                className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md border border-border-subtle bg-canvas p-1 shadow-lg"
              >
                {shells.map((shell) => (
                  <button
                    key={shell.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      addSession(undefined, shell.id);
                      setShellMenuOpen(false);
                    }}
                    className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-fg hover:bg-hover"
                  >
                    {shell.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {sessions.length === 0 ? (
          <div className="flex h-full w-full items-center justify-center text-xs text-fg-muted">
            No terminal open
          </div>
        ) : (
          <>
            <div className={cn('min-h-0 min-w-0', splitId !== null ? 'flex-1 border-r border-border-subtle' : 'flex-1')}>
              {sessions.map((session) => (
                <TerminalInstance key={session.id} sessionId={session.id} visible={session.id === activeId} />
              ))}
            </div>
            {splitId !== null && (
              <div className="min-h-0 min-w-0 flex-1">
                <TerminalInstance sessionId={splitId} visible />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TerminalTab({
  session,
  active,
  onSelect,
  onClose,
  onSplit,
}: {
  session: TerminalSession;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onSplit: () => void;
}): React.JSX.Element {
  const label = session.processName ?? session.title;
  return (
    <div
      className={cn(
        'group flex shrink-0 items-center gap-1.5 border-r border-border-subtle pl-3 pr-1 text-xs',
        active ? 'bg-canvas text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={onSelect}
        title={session.shellLabel === '' ? label : `${label} — ${session.shellLabel}`}
        className="flex items-center gap-1.5 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline"
      >
        <TerminalIcon className="size-3.5 shrink-0" />
        <span className="whitespace-nowrap">{label}</span>
        {session.shellLabel !== '' && (
          <span className="whitespace-nowrap text-[10px] text-fg-muted">{session.shellLabel}</span>
        )}
      </button>
      <button
        type="button"
        aria-label={`Split with ${label}`}
        title="Split terminal"
        onClick={onSplit}
        className="rounded-sm p-0.5 text-fg-muted opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100 focus-visible:opacity-100"
      >
        <TerminalIcon className="size-3" />
      </button>
      <button
        type="button"
        aria-label={`Close ${label}`}
        onClick={onClose}
        className="rounded-sm p-0.5 text-fg-muted opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
      >
        <WinCloseIcon className="size-3" />
      </button>
    </div>
  );
}

/**
 * Memoized: `TerminalPanel` re-renders on every session-list change (a new tab opening, another
 * tab's title updating), and without this every OTHER already-mounted TerminalInstance re-rendered
 * along with it — wasted work, since xterm itself is imperative (mounted once into `container` via
 * a ref, per the mount effect below) and has nothing to gain from a parent re-render it doesn't
 * also need new props from.
 */
const TerminalInstance = memo(function TerminalInstance({
  sessionId,
  visible,
}: {
  sessionId: string;
  visible: boolean;
}): React.JSX.Element {
  const theme = useUiStore((s) => s.theme);
  const fontSize = useUiStore((s) => s.terminalFontSize);
  const setTerminalFontSize = useUiStore((s) => s.setTerminalFontSize);
  const setProcessName = useTerminalStore((s) => s.setProcessName);
  const setShellLabel = useTerminalStore((s) => s.setShellLabel);
  const container = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = container.current;
    if (el === null) return;

    const session = useTerminalStore.getState().sessions.find((s) => s.id === sessionId);
    const term = new XTerm({
      cursorBlink: true,
      fontSize: useUiStore.getState().terminalFontSize,
      // Same monospace stack as the editor (`diff-editor.tsx`) — a terminal that renders code
      // output in a different font from the editor above it reads as two different tools bolted
      // together rather than one workbench.
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      theme: xtermTheme(useUiStore.getState().theme),
      // Ctrl+C/Ctrl+V/Ctrl+L/Ctrl+=/Ctrl+-/Ctrl+Shift+F are all intercepted below (copy-on-selection,
      // paste, clear, font size, search) rather than forwarded as raw bytes to the shell — this
      // opts xterm out of its own default handling for exactly those combinations so the
      // interception is the only thing that fires, not both.
      rightClickSelectsWord: false,
      // Bounded so an extremely chatty command (a build's own log spam, `git log` on a huge repo)
      // does not grow the terminal's retained line buffer without limit for the life of the tab.
      scrollback: 1000,
      // xterm.js's modern replacement for the old `windowsMode` option (renamed when the package
      // moved to the @xterm scope) — the ConPTY-aware reflow/scrollback heuristics node-pty's own
      // Windows backend needs. node-pty always uses ConPTY on modern Windows, so this is safe
      // unconditionally on this platform; `navigator.userAgent` is the only platform signal
      // available here (the renderer is sandboxed, no `process.platform`).
      ...(navigator.userAgent.includes('Windows') ? { windowsPty: { backend: 'conpty' } } : {}),
    });
    termRef.current = term;
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    const search = new SearchAddon();
    searchRef.current = search;
    term.loadAddon(search);
    term.open(el);
    fit.fit();

    // WebGL rendering is dramatically cheaper than the DOM renderer for a terminal's own workload
    // (a grid of monospace cells redrawn on every line of output) — falls back to the Canvas
    // renderer, and from there to xterm's default DOM renderer, rather than a broken terminal, on
    // a machine/driver combination WebGL2 does not work on (a real, not hypothetical, case —
    // `WebglAddon` itself documents this fallback path).
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
      });
      term.loadAddon(webgl);
    } catch {
      try {
        term.loadAddon(new CanvasAddon());
      } catch {
        // Neither renderer initialized — xterm's own DOM renderer is what's left, and it is a
        // correct (if slower) terminal, not a broken one.
      }
    }

    // Copy-on-Ctrl+C-with-a-selection, paste-on-Ctrl+V, clear-on-Ctrl+L, font size on Ctrl+=/-,
    // search on Ctrl+Shift+F — VS Code's own terminal keymap. `false` stops xterm from ALSO
    // handling the keystroke itself (forwarding it to the shell as a raw byte).
    // No disposable to hold onto — attachCustomKeyEventHandler is `void`; it lives and dies with
    // the terminal instance itself, torn down by term.dispose() below.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return true;
      if (event.key === 'c' && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection());
        return false;
      }
      if (event.key === 'v') {
        void navigator.clipboard.readText().then((text) => {
          void invoke('terminal:write', { id: sessionId, data: text });
        });
        return false;
      }
      if (event.key === 'l') {
        term.clear();
        return false;
      }
      if (event.key === '=' || event.key === '+') {
        setTerminalFontSize(useUiStore.getState().terminalFontSize + 1);
        return false;
      }
      if (event.key === '-') {
        setTerminalFontSize(useUiStore.getState().terminalFontSize - 1);
        return false;
      }
      if (event.shiftKey && event.key.toLowerCase() === 'f') {
        setSearchOpen((v) => !v);
        return false;
      }
      return true;
    });

    let disposed = false;
    const unsubscribeData = subscribe('terminal:data', (payload) => {
      if (payload.id === sessionId) term.write(payload.data);
    });
    const unsubscribeExit = subscribe('terminal:exit', (payload) => {
      if (payload.id === sessionId) {
        term.writeln(`\r\n[process exited with code ${String(payload.exitCode)}]`);
      }
    });
    const unsubscribeTitle = subscribe('terminal:title', (payload) => {
      if (payload.id === sessionId) setProcessName(sessionId, payload.processName);
    });

    void invoke('terminal:create', {
      id: sessionId,
      cols: term.cols,
      rows: term.rows,
      ...(session?.shellId !== undefined ? { shellId: session.shellId } : {}),
    }).then((result) => {
      if (disposed) {
        void invoke('terminal:dispose', { id: sessionId });
        return;
      }
      if (!result.ok) {
        term.writeln(`\r\n[failed to start a shell: ${result.error.message}]`);
        return;
      }
      setShellLabel(sessionId, result.value.shell);
      const pending = useTerminalStore.getState().takePendingCommand(sessionId);
      if (pending !== null) void invoke('terminal:write', { id: sessionId, data: `${pending}\r` });
    });

    const onData = term.onData((data) => {
      void invoke('terminal:write', { id: sessionId, data });
    });

    const resizeObserver = new ResizeObserver(() => {
      // A hidden pane (`display: none`) reports a zero-size ResizeObserver entry; fitting to that
      // would collapse the PTY to 0 cols/rows. Only fit while actually visible.
      if (container.current?.offsetParent === null) return;
      fit.fit();
      void invoke('terminal:resize', { id: sessionId, cols: term.cols, rows: term.rows });
    });
    resizeObserver.observe(el);

    return () => {
      disposed = true;
      termRef.current = null;
      resizeObserver.disconnect();
      onData.dispose();
      unsubscribeData();
      unsubscribeExit();
      unsubscribeTitle();
      term.dispose();
      void invoke('terminal:dispose', { id: sessionId });
    };
    // sessionId never changes for a mounted instance (it is the component's own key); this effect
    // is mount/unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fit on becoming visible — a resize that happened while hidden was skipped (see above), so
  // the pane can be showing a stale column count until the user actually resizes the window again.
  useEffect(() => {
    if (visible) fitRef.current?.fit();
  }, [visible]);

  useEffect(() => {
    const term = termRef.current;
    if (term !== null) term.options.theme = xtermTheme(theme);
  }, [theme]);

  useEffect(() => {
    const term = termRef.current;
    if (term !== null) {
      term.options.fontSize = fontSize;
      fitRef.current?.fit();
    }
  }, [fontSize]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.findNext(searchQuery);
  }, [searchQuery, searchOpen]);

  return (
    <div
      role="tabpanel"
      aria-label="Terminal"
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
      className={cn('relative flex h-full w-full flex-col overflow-hidden', !visible && 'hidden')}
    >
      {searchOpen && (
        <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-raised px-2">
          <SearchIcon className="size-3 shrink-0 text-fg-muted" />
          <input
            autoFocus
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              searchRef.current?.findNext(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSearchOpen(false);
              if (e.key === 'Enter') searchRef.current?.findNext(searchQuery);
            }}
            placeholder="Search terminal output"
            className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-muted"
          />
          <button
            type="button"
            aria-label="Close search"
            onClick={() => {
              setSearchOpen(false);
            }}
            className="shrink-0 text-fg-muted hover:text-fg"
          >
            <WinCloseIcon className="size-3" />
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 p-2">
        <div ref={container} className="h-full w-full" />
      </div>
      {contextMenu !== null && (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => {
              setContextMenu(null);
            }}
          />
          <div
            role="menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            className="fixed z-50 w-36 rounded-md border border-border-subtle bg-canvas p-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const term = termRef.current;
                if (term?.hasSelection() === true) void navigator.clipboard.writeText(term.getSelection());
                setContextMenu(null);
              }}
              className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-fg hover:bg-hover"
            >
              Copy
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void navigator.clipboard.readText().then((text) => {
                  void invoke('terminal:write', { id: sessionId, data: text });
                });
                setContextMenu(null);
              }}
              className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-fg hover:bg-hover"
            >
              Paste
            </button>
          </div>
        </>
      )}
    </div>
  );
});
