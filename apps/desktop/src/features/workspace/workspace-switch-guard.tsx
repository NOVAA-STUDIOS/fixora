import { ConfirmDialog } from '@fixora/ui';

import { useEditorStore } from '../editor/editor-store.js';

import { useWorkspaceStore } from './workspace-store.js';

/**
 * The one unsaved-changes confirmation for leaving the current workspace, shared by every entry
 * point that can do it: Recent Projects, Quick Actions, the Open menu's "Recent" list and "Close
 * folder", reopen-last, and the command palette's "Open Folder…". Mounted once in `AppShell`
 * (always present, regardless of which screen — Home or Workbench — is showing), because the
 * store gates `openPath`/`close` themselves rather than leaving each caller to remember its own
 * check (beta audit A2, Workspace switching finding: only "Close folder" used to check).
 */
export function WorkspaceSwitchGuard(): React.JSX.Element {
  const pendingAction = useWorkspaceStore((s) => s.pendingAction);
  const confirmPendingAction = useWorkspaceStore((s) => s.confirmPendingAction);
  const cancelPendingAction = useWorkspaceStore((s) => s.cancelPendingAction);
  const dirtyCount = useEditorStore((s) => s.dirty.length);

  const closing = pendingAction?.type === 'close';

  return (
    <ConfirmDialog
      open={pendingAction !== null}
      onOpenChange={(open) => {
        if (!open) cancelPendingAction();
      }}
      title={closing ? 'Close project without saving?' : 'Switch project without saving?'}
      description={
        dirtyCount === 1
          ? `1 file has unsaved changes. ${closing ? 'Closing' : 'Switching projects'} discards them.`
          : `${String(dirtyCount)} files have unsaved changes. ${closing ? 'Closing' : 'Switching projects'} discards them.`
      }
      confirmLabel={closing ? 'Discard and close' : 'Discard and switch'}
      onConfirm={() => void confirmPendingAction()}
    />
  );
}
