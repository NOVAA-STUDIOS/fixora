import { PROJECT_TEMPLATES } from '@fixora/shared-types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  FolderIcon,
  cn,
} from '@fixora/ui';
import { useEffect, useState } from 'react';

import { invoke } from '../../lib/bridge.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

/** Folder-name-safe: no path separators, no shell metacharacters the scaffold command could trip
 * on — checked again in project.handlers.ts, since the renderer's check is a UX nicety, not the
 * boundary (invariant I2). */
const VALID_NAME = /^[a-zA-Z0-9._-]+$/;

/**
 * New Project: pick a template, a name and a location, then Create runs the scaffold command as a
 * silent background process (`project:create` — see project-service.ts) and opens the result when
 * it finishes. No terminal, no visible process output — just a simple "Creating…" state, because
 * scaffolding a project is not something the user needs to supervise line by line, and a modal
 * that shows raw tool output is a worse experience than one that just gets out of the way and
 * reports the outcome.
 */
export function NewProjectModal(): React.JSX.Element {
  const open = useUiStore((s) => s.newProjectOpen);
  const setOpen = useUiStore((s) => s.setNewProjectOpen);
  const openPath = useWorkspaceStore((s) => s.openPath);

  const [templateId, setTemplateId] = useState(PROJECT_TEMPLATES[0]?.id ?? '');
  const [name, setName] = useState('');
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [phase, setPhase] = useState<'form' | 'creating' | 'failed'>('form');
  const [error, setError] = useState<string | null>(null);

  // Reset to a clean form every time the modal is (re)opened, rather than resuming a stale run.
  useEffect(() => {
    if (!open) return;
    setPhase('form');
    setError(null);
    setName('');
    setParentDir(null);
  }, [open]);

  async function chooseLocation(): Promise<void> {
    const result = await invoke('workspace:pickFolder', {});
    if (result.ok && result.value.path !== null) {
      setParentDir(result.value.path);
      setError(null);
    }
  }

  async function create(): Promise<void> {
    if (parentDir === null) return;
    if (!VALID_NAME.test(name)) {
      setError('Project name may only contain letters, numbers, dots, dashes and underscores.');
      return;
    }
    setPhase('creating');
    const result = await invoke('project:create', { parentDir, name, templateId });
    if (!result.ok) {
      setError(result.error.message);
      setPhase('failed');
      return;
    }
    await openPath(result.value.path);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl">
        <DialogTitle>New Project</DialogTitle>
        <DialogDescription>
          {phase === 'form'
            ? 'Pick a template and a location. Fixora scaffolds it in the background and opens the result.'
            : phase === 'creating'
              ? 'Creating your project…'
              : 'The scaffold command failed.'}
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

            {error !== null && (
              <p role="alert" className="text-xs text-danger-text [overflow-wrap:anywhere]">
                {error}
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

        {phase === 'creating' && (
          <div className="mt-6 flex flex-col items-center gap-3 py-6">
            <span
              role="status"
              aria-label="Creating project"
              className="size-6 animate-spin rounded-full border-2 border-border-strong border-t-accent-solid"
            />
            <p className="text-xs text-fg-muted">This can take a minute — packages are downloading.</p>
          </div>
        )}

        {phase === 'failed' && (
          <div className="mt-4 flex flex-col gap-3">
            {error !== null && (
              <p
                role="alert"
                className="max-h-48 overflow-y-auto rounded border border-border-subtle bg-inset p-2 text-xs whitespace-pre-wrap text-danger-text [overflow-wrap:anywhere]"
              >
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPhase('form');
                }}
              >
                Back
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false);
                }}
              >
                Close
              </Button>
              {error !== null && error.includes('nodejs.org') && (
                <Button variant="primary" size="sm" onClick={() => void invoke('app:relaunch', {})}>
                  Restart Fixora
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
