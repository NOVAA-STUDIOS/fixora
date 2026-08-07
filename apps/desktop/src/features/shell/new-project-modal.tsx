import '@xterm/xterm/css/xterm.css';

import { dark, light } from '@fixora/tokens';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  FolderIcon,
  cn,
} from '@fixora/ui';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';

import { invoke, subscribe } from '../../lib/bridge.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { PROJECT_TEMPLATES } from './project-templates.js';

/** Bytes cmd.exe writes to mark where the scaffold command ends, with its own exit code appended
 * — reading a shell's OWN prompt back is not a reliable "done" signal, and the PTY session itself
 * is long-lived (a real cmd.exe, kept open for the user to keep using), so `terminal:exit` never
 * fires for a single command finishing inside it. This marker is the alternative. */
const DONE_MARKER = 'FIXORA_SCAFFOLD_DONE_';

/** Folder-name-safe: no path separators, no shell metacharacters the unquoted command could trip on. */
const VALID_NAME = /^[a-zA-Z0-9._-]+$/;

export function NewProjectModal(): React.JSX.Element {
  const open = useUiStore((s) => s.newProjectOpen);
  const setOpen = useUiStore((s) => s.setNewProjectOpen);
  const openPath = useWorkspaceStore((s) => s.openPath);
  const theme = useUiStore((s) => s.theme);

  const [templateId, setTemplateId] = useState(PROJECT_TEMPLATES[0]?.id ?? '');
  const [name, setName] = useState('');
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [phase, setPhase] = useState<'form' | 'running' | 'failed'>('form');
  const [pickError, setPickError] = useState<string | null>(null);

  const container = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const sessionId = useRef<string | null>(null);
  const outputBuffer = useRef('');

  // Reset to a clean form every time the modal is (re)opened, rather than resuming a stale run.
  useEffect(() => {
    if (!open) return;
    setPhase('form');
    setPickError(null);
    setName('');
    setParentDir(null);
    outputBuffer.current = '';
  }, [open]);

  useEffect(() => {
    const term = termRef.current;
    if (term !== null) {
      const c = theme === 'dark' ? dark : light;
      term.options.theme = { background: c.bg.canvas, foreground: c.text.primary };
    }
  }, [theme]);

  async function chooseLocation(): Promise<void> {
    const result = await invoke('workspace:pickFolder', {});
    if (result.ok && result.value.path !== null) {
      setParentDir(result.value.path);
      setPickError(null);
    }
  }

  async function create(): Promise<void> {
    const template = PROJECT_TEMPLATES.find((t) => t.id === templateId);
    if (template === undefined || parentDir === null) return;
    if (!VALID_NAME.test(name)) {
      setPickError('Project name may only contain letters, numbers, dots, dashes and underscores.');
      return;
    }

    const el = container.current;
    if (el === null) return;
    setPhase('running');

    const id = crypto.randomUUID();
    sessionId.current = id;
    const c = theme === 'dark' ? dark : light;
    const term = new XTerm({
      cursorBlink: true,
      fontSize: 12.5,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      theme: { background: c.bg.canvas, foreground: c.text.primary },
      disableStdin: false,
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    const unsubscribeData = subscribe('terminal:data', (payload) => {
      if (payload.id !== id) return;
      term.write(payload.data);
      outputBuffer.current += payload.data;
      const markerAt = outputBuffer.current.indexOf(DONE_MARKER);
      if (markerAt === -1) return;
      const code = outputBuffer.current.slice(markerAt + DONE_MARKER.length, markerAt + DONE_MARKER.length + 1);
      unsubscribeData();
      void invoke('terminal:dispose', { id });
      if (code === '0') {
        // Windows-only join (this app's only shipped target): the dialog result already uses `\`.
        const sep = parentDir.endsWith('\\') ? '' : '\\';
        void openPath(`${parentDir}${sep}${name}`).then(() => {
          setOpen(false);
        });
      } else {
        setPhase('failed');
      }
    });

    term.onData((data) => {
      void invoke('terminal:write', { id, data });
    });

    const result = await invoke('terminal:createScratch', { id, cwd: parentDir, cols: term.cols, rows: term.rows });
    if (!result.ok) {
      term.writeln(`\r\n[could not start: ${result.error.message}]`);
      unsubscribeData();
      setPhase('failed');
      return;
    }
    // `&` (not `&&`) on the marker echo: it must print regardless of whether the scaffold command
    // succeeded — the digit after the marker is what carries success/failure, not its presence.
    void invoke('terminal:write', {
      id,
      data: `${template.command(name)} & echo ${DONE_MARKER}%errorlevel%\r`,
    });
  }

  useEffect(
    () => () => {
      const id = sessionId.current;
      if (id !== null) void invoke('terminal:dispose', { id });
      termRef.current?.dispose();
    },
    [],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className={cn('max-w-xl', phase === 'running' && 'max-w-2xl')}>
        <DialogTitle>New Project</DialogTitle>
        <DialogDescription>
          {phase === 'form'
            ? 'Pick a template and a location — Fixora runs the scaffold command in an integrated terminal and opens the result.'
            : phase === 'running'
              ? 'Running the scaffold command. Interactive prompts can be answered directly below.'
              : 'The scaffold command failed. See the output below.'}
        </DialogDescription>

        {phase === 'form' && (
          <div className="mt-4 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PROJECT_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTemplateId(t.id);
                  }}
                  aria-pressed={t.id === templateId}
                  className={cn(
                    'flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors duration-(--fx-motion-duration-fast)',
                    t.id === templateId
                      ? 'border-accent-border bg-accent-subtle'
                      : 'border-border-subtle hover:bg-hover',
                  )}
                >
                  <span className="text-sm font-medium text-fg">{t.label}</span>
                  <span className="text-[11px] text-fg-muted">{t.description}</span>
                </button>
              ))}
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-secondary">Project name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                placeholder="my-app"
                className="rounded border border-border-strong bg-inset px-2 py-1.5 text-sm text-fg outline-none focus-visible:outline-2 focus-visible:outline-focus-ring"
              />
            </label>

            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => void chooseLocation()}>
                <FolderIcon className="size-3.5" />
                {parentDir === null ? 'Choose location' : 'Change location'}
              </Button>
              {parentDir !== null && (
                <span className="min-w-0 truncate text-xs text-fg-muted" title={parentDir}>
                  {parentDir}
                </span>
              )}
            </div>

            {pickError !== null && (
              <p role="alert" className="text-xs text-danger-text">
                {pickError}
              </p>
            )}

            <div className="mt-2 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={name.trim() === '' || parentDir === null}
                onClick={() => void create()}
              >
                Create
              </Button>
            </div>
          </div>
        )}

        <div
          ref={container}
          className={cn('mt-3 h-64 w-full overflow-hidden rounded-md bg-canvas p-2', phase === 'form' && 'hidden')}
        />

        {phase === 'failed' && (
          <div className="mt-3 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
              }}
            >
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
