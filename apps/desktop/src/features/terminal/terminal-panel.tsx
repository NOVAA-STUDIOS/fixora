import '@xterm/xterm/css/xterm.css';

import { dark, light } from '@fixora/tokens';
import { TerminalIcon } from '@fixora/ui';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import { useEffect, useRef } from 'react';

import { invoke, subscribe } from '../../lib/bridge.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

/** xterm needs concrete hex, not CSS variables — same constraint and source Monaco's theme uses
 * (`monaco-theme.ts`), so the terminal's surface is the same canvas/text pair as the editor's. */
function xtermTheme(appearance: 'dark' | 'light'): { background: string; foreground: string } {
  const c = appearance === 'dark' ? dark : light;
  return { background: c.bg.canvas, foreground: c.text.primary };
}

/**
 * The integrated terminal (Terminal tab, activity rail). One `node-pty` session per mount, rooted
 * at the open workspace — main refuses `terminal:create` with no workspace open, so this only
 * ever renders once `Workbench` already knows a project is open (same gate as Files/Problems).
 *
 * xterm.js owns the rendering; this component is the wiring between it and the typed IPC bridge —
 * `invoke` for create/write/resize/dispose, `subscribe` for the output stream. No `ipcRenderer`
 * reaches here, same as every other renderer feature (Security §2).
 */
export function TerminalPanel(): React.JSX.Element {
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id ?? null);
  const theme = useUiStore((s) => s.theme);
  const container = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);

  useEffect(() => {
    const el = container.current;
    if (el === null || workspaceId === null) return;

    // One id per mount, not per workspace: switching projects tears this component down (the
    // workbench keys on activeView, not on workspace), so a stale session from a previous folder
    // can never be written to.
    const id = crypto.randomUUID();
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
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    let disposed = false;
    const unsubscribeData = subscribe('terminal:data', (payload) => {
      if (payload.id === id) term.write(payload.data);
    });
    const unsubscribeExit = subscribe('terminal:exit', (payload) => {
      if (payload.id === id) term.writeln(`\r\n[process exited with code ${String(payload.exitCode)}]`);
    });

    void invoke('terminal:create', { id, cols: term.cols, rows: term.rows }).then((result) => {
      // The mount raced an unmount (fast tab-switch); the session was created but nothing here
      // still wants it — dispose it rather than leak a shell process.
      if (disposed) {
        void invoke('terminal:dispose', { id });
        return;
      }
      if (!result.ok) term.writeln(`\r\n[failed to start a shell: ${result.error.message}]`);
    });

    const onData = term.onData((data) => {
      void invoke('terminal:write', { id, data });
    });

    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      void invoke('terminal:resize', { id, cols: term.cols, rows: term.rows });
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
      void invoke('terminal:dispose', { id });
    };
  }, [workspaceId]);

  // Same live-swap the editor does on a theme toggle (`monaco-theme.ts`'s `setTheme` effect) —
  // without this the terminal stayed on whichever theme was active when the shell was opened.
  useEffect(() => {
    const term = termRef.current;
    if (term !== null) term.options.theme = xtermTheme(theme);
  }, [theme]);

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-canvas">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-raised px-3">
        <TerminalIcon className="size-3.5 shrink-0 text-fg-muted" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-secondary">
          Terminal
        </span>
      </div>
      <div role="tabpanel" aria-label="Terminal" className="min-h-0 flex-1 overflow-hidden p-2">
        <div ref={container} className="h-full w-full" />
      </div>
    </div>
  );
}
