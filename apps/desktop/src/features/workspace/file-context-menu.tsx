import { Button, ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogTitle } from '@fixora/ui';
import { useEffect, useRef, useState } from 'react';

import { basename, dirname } from '../../lib/path.js';

import { useWorkspaceStore } from './workspace-store.js';

/**
 * New File / New Folder / Rename / Delete — the file tree's context menu, plus the "+" button in
 * the header (`workspace-panel.tsx`), which is really the same menu with an implicit target: the
 * workspace root rather than a right-clicked row. One name-prompt dialog and one confirm dialog
 * serve every entry point, rather than each duplicating its own modal.
 */
export type MenuTarget = { relPath: string; kind: 'dir' | 'file' } | { relPath: ''; kind: 'root' };

type PendingAction =
  | { type: 'newFile'; dirRelPath: string }
  | { type: 'newFolder'; dirRelPath: string }
  | { type: 'rename'; relPath: string; currentName: string }
  | { type: 'delete'; relPath: string; name: string };

export function useFileActions(): {
  openMenu: (target: MenuTarget, x: number, y: number) => void;
  menu: React.ReactNode;
} {
  const [contextMenu, setContextMenu] = useState<{ target: MenuTarget; x: number; y: number } | null>(
    null,
  );
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createFile = useWorkspaceStore((s) => s.createFile);
  const createFolder = useWorkspaceStore((s) => s.createFolder);
  const renameEntry = useWorkspaceStore((s) => s.renameEntry);
  const deleteEntry = useWorkspaceStore((s) => s.deleteEntry);

  const openMenu = (target: MenuTarget, x: number, y: number): void => {
    setContextMenu({ target, x, y });
  };

  // A directory target creates INSIDE it; a file target creates alongside it (its parent) — the
  // same rule VS Code's own tree context menu follows.
  const dirFor = (target: MenuTarget): string =>
    target.kind === 'file' ? dirname(target.relPath) : target.relPath;

  const menu = (
    <>
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
            className="fixed z-50 w-44 rounded-md border border-border-subtle bg-canvas p-1 shadow-lg"
          >
            <MenuItem
              label="New File"
              onClick={() => {
                setPending({ type: 'newFile', dirRelPath: dirFor(contextMenu.target) });
                setContextMenu(null);
              }}
            />
            <MenuItem
              label="New Folder"
              onClick={() => {
                setPending({ type: 'newFolder', dirRelPath: dirFor(contextMenu.target) });
                setContextMenu(null);
              }}
            />
            {contextMenu.target.kind !== 'root' && (
              <>
                <div className="my-1 border-t border-border-subtle" />
                <MenuItem
                  label="Rename"
                  onClick={() => {
                    if (contextMenu.target.kind === 'root') return;
                    setPending({
                      type: 'rename',
                      relPath: contextMenu.target.relPath,
                      currentName: basename(contextMenu.target.relPath),
                    });
                    setContextMenu(null);
                  }}
                />
                <MenuItem
                  label="Delete"
                  danger
                  onClick={() => {
                    if (contextMenu.target.kind === 'root') return;
                    setPending({
                      type: 'delete',
                      relPath: contextMenu.target.relPath,
                      name: basename(contextMenu.target.relPath),
                    });
                    setContextMenu(null);
                  }}
                />
              </>
            )}
          </div>
        </>
      )}

      <NamePromptDialog
        open={pending?.type === 'newFile' || pending?.type === 'newFolder'}
        title={pending?.type === 'newFile' ? 'New File' : 'New Folder'}
        // Where it will actually land. The + button's target follows the tree selection now, so
        // "New File" alone no longer tells the user which folder they are about to create in.
        targetDir={
          pending?.type === 'newFile' || pending?.type === 'newFolder' ? pending.dirRelPath : ''
        }
        initialValue=""
        onCancel={() => {
          setPending(null);
        }}
        onConfirm={async (name) => {
          if (pending === null) return;
          const message =
            pending.type === 'newFile'
              ? await createFile(pending.dirRelPath, name)
              : pending.type === 'newFolder'
                ? await createFolder(pending.dirRelPath, name)
                : null;
          if (message !== null) setError(message);
          setPending(null);
        }}
      />

      <NamePromptDialog
        open={pending?.type === 'rename'}
        title="Rename"
        initialValue={pending?.type === 'rename' ? pending.currentName : ''}
        onCancel={() => {
          setPending(null);
        }}
        onConfirm={async (name) => {
          if (pending?.type !== 'rename') return;
          const message = await renameEntry(pending.relPath, name);
          if (message !== null) setError(message);
          setPending(null);
        }}
      />

      <ConfirmDialog
        open={pending?.type === 'delete'}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title="Delete"
        description={
          pending?.type === 'delete' ? `Delete "${pending.name}"? This cannot be undone.` : ''
        }
        confirmLabel="Delete"
        onConfirm={() => {
          if (pending?.type !== 'delete') return;
          const { relPath } = pending;
          setPending(null);
          void deleteEntry(relPath).then((message) => {
            if (message !== null) setError(message);
          });
        }}
      />

      <ConfirmDialog
        open={error !== null}
        onOpenChange={(open) => {
          if (!open) setError(null);
        }}
        title="Couldn't do that"
        description={error ?? ''}
        confirmLabel="OK"
        destructive={false}
        onConfirm={() => {
          setError(null);
        }}
      />
    </>
  );

  return { openMenu, menu };
}

function MenuItem({
  label,
  onClick,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={
        danger
          ? 'flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-danger-text hover:bg-danger-subtle'
          : 'flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-fg hover:bg-hover'
      }
    >
      {label}
    </button>
  );
}

function NamePromptDialog({
  open,
  title,
  initialValue,
  targetDir,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  initialValue: string;
  /** Workspace-relative destination ('' = project root). Omitted by the rename prompt, which
   * renames in place and has no destination to disclose. */
  targetDir?: string;
  onConfirm: (name: string) => void | Promise<void>;
  onCancel: () => void;
}): React.JSX.Element {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      // Selected, not just focused — renaming is the common case here, and the user almost always
      // wants to replace the whole name rather than edit around the existing one.
      requestAnimationFrame(() => {
        inputRef.current?.select();
      });
    }
  }, [open, initialValue]);

  const submit = (): void => {
    const trimmed = value.trim();
    if (trimmed !== '') void onConfirm(trimmed);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {targetDir === undefined
            ? 'Enter a name.'
            : targetDir === ''
              ? 'Creating at the project root.'
              : `Creating in ${targetDir}/`}
        </DialogDescription>
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder={
            targetDir === undefined ? undefined : targetDir === '' ? 'name' : `${targetDir}/name`
          }
          onChange={(e) => {
            setValue(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          className="mt-3 w-full rounded border border-border-strong bg-inset px-2 py-1.5 text-sm text-fg outline-none focus-visible:outline-2 focus-visible:outline-focus-ring"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={value.trim() === ''} onClick={submit}>
            OK
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

