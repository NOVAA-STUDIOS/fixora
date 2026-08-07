import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import { useEffect, useRef } from 'react';

import { invoke, subscribe } from '../../lib/bridge.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

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
  const container = useRef<HTMLDivElement>(null);

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
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      // Colours only — never the font/cursor to a canvas the DOM inspector cannot help with. Kept
      // deliberately independent of the app's own light/dark theme tokens: a terminal is styled
      // like a terminal, matching what every other Electron IDE ships, and shell output that
      // assumes a dark background (many CLIs colour for one) does not go illegible in light mode.
      theme: { background: '#1a1b26', foreground: '#c0caf5' },
    });
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
      resizeObserver.disconnect();
      onData.dispose();
      unsubscribeData();
      unsubscribeExit();
      term.dispose();
      void invoke('terminal:dispose', { id });
    };
  }, [workspaceId]);

  return (
    <div
      role="tabpanel"
      aria-label="Terminal"
      className="h-full w-full min-w-0 overflow-hidden bg-[#1a1b26] p-2"
    >
      <div ref={container} className="h-full w-full" />
    </div>
  );
}
