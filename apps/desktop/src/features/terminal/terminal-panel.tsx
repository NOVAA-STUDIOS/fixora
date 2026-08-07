import '@xterm/xterm/css/xterm.css';

import { dark, light } from '@fixora/tokens';
import { PlusIcon, TerminalIcon, WinCloseIcon, cn } from '@fixora/ui';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import { useEffect, useRef } from 'react';

import { invoke, subscribe } from '../../lib/bridge.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { useTerminalStore } from './terminal-store.js';

/** xterm needs concrete hex, not CSS variables — same constraint and source Monaco's theme uses
 * (`monaco-theme.ts`), so the terminal's surface is the same canvas/text pair as the editor's. */
function xtermTheme(appearance: 'dark' | 'light'): { background: string; foreground: string } {
  const c = appearance === 'dark' ? dark : light;
  return { background: c.bg.canvas, foreground: c.text.primary };
}

/**
 * The integrated terminal (Terminal tab, activity rail) — now a tab strip over several persistent
 * sessions, VS Code-style: switching tabs hides/shows a session's pane via CSS rather than
 * unmounting it, so a background shell's output keeps accumulating and a running command keeps
 * running while you look at a different tab. Each `TerminalInstance` owns exactly one `node-pty`
 * session and exactly one xterm instance for its whole lifetime.
 */
export function TerminalPanel(): React.JSX.Element {
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id ?? null);
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeId);
  const addSession = useTerminalStore((s) => s.addSession);
  const closeSession = useTerminalStore((s) => s.closeSession);
  const setActive = useTerminalStore((s) => s.setActive);

  // The first tab, once — a workspace opening is what makes a terminal meaningful to have; this
  // does not re-run on every remount because sessions.length is 0 only the very first time.
  useEffect(() => {
    if (workspaceId !== null && sessions.length === 0) addSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-canvas">
      <div className="flex h-9 shrink-0 items-stretch border-b border-border-subtle bg-raised">
        <div role="tablist" aria-label="Terminals" className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                'group flex shrink-0 items-center gap-1.5 border-r border-border-subtle pl-3 pr-1 text-xs',
                session.id === activeId ? 'bg-canvas text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={session.id === activeId}
                onClick={() => {
                  setActive(session.id);
                }}
                className="flex items-center gap-1.5 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline"
              >
                <TerminalIcon className="size-3.5 shrink-0" />
                <span className="whitespace-nowrap">{session.title}</span>
              </button>
              <button
                type="button"
                aria-label={`Close ${session.title}`}
                onClick={() => {
                  closeSession(session.id);
                }}
                className="rounded-sm p-0.5 text-fg-muted opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
              >
                <WinCloseIcon className="size-3" />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          aria-label="New terminal"
          title="New terminal"
          onClick={() => {
            addSession();
          }}
          className="flex shrink-0 items-center border-l border-border-subtle px-2 text-fg-muted hover:bg-hover hover:text-fg"
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {sessions.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-fg-muted">
            No terminal open
          </div>
        ) : (
          sessions.map((session) => (
            <TerminalInstance key={session.id} sessionId={session.id} visible={session.id === activeId} />
          ))
        )}
      </div>
    </div>
  );
}

function TerminalInstance({
  sessionId,
  visible,
}: {
  sessionId: string;
  visible: boolean;
}): React.JSX.Element {
  const theme = useUiStore((s) => s.theme);
  const container = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const el = container.current;
    if (el === null) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      // Same monospace stack as the editor (`diff-editor.tsx`) — a terminal that renders code
      // output in a different font from the editor above it reads as two different tools bolted
      // together rather than one workbench.
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      theme: xtermTheme(useUiStore.getState().theme),
    });
    termRef.current = term;
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    let disposed = false;
    const unsubscribeData = subscribe('terminal:data', (payload) => {
      if (payload.id === sessionId) term.write(payload.data);
    });
    const unsubscribeExit = subscribe('terminal:exit', (payload) => {
      if (payload.id === sessionId) {
        term.writeln(`\r\n[process exited with code ${String(payload.exitCode)}]`);
      }
    });

    void invoke('terminal:create', { id: sessionId, cols: term.cols, rows: term.rows }).then((result) => {
      if (disposed) {
        void invoke('terminal:dispose', { id: sessionId });
        return;
      }
      if (!result.ok) {
        term.writeln(`\r\n[failed to start a shell: ${result.error.message}]`);
        return;
      }
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

  return (
    <div
      role="tabpanel"
      aria-label="Terminal"
      className={cn('h-full w-full overflow-hidden p-2', !visible && 'hidden')}
    >
      <div ref={container} className="h-full w-full" />
    </div>
  );
}
