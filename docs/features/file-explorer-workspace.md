# File Explorer & Workspace — Audit A2 remediation

Fixes from the A2 beta-readiness audit of the File Explorer & Workspace module. Scope: prevent
silent data loss on workspace switch, make the file tree genuinely keyboard-operable, replace a
misleading error message, and add two missing states (empty workspace, directory-expand loading).

## Unsaved-changes guard on workspace switch

Every way of leaving the current workspace — Recent Projects, Quick Actions' "Open recent",
`OpenMenu`'s "Recent" list and "Open folder…", "Close folder", reopen-last, and the command
palette's "Open Folder…" — funnels through `useWorkspaceStore`'s `openPath()` or `close()`. Both
now check `useEditorStore`'s `dirty` list before acting: with unsaved edits, they set
`pendingAction` (`{ type: 'switch', path }` or `{ type: 'close' }`) instead of proceeding.

`WorkspaceSwitchGuard` (`apps/desktop/src/features/workspace/workspace-switch-guard.tsx`), mounted
once in `AppShell`, renders the one shared `ConfirmDialog` for both cases — "Switch project without
saving?" / "Close project without saving?" — and calls `confirmPendingAction()` (carry out the
blocked action, discarding the edits) or `cancelPendingAction()` (stay put, edits untouched).

Previously, only `OpenMenu`'s "Close folder" checked for unsaved edits; every other switch path
discarded them silently. Centralizing the guard in the store, rather than patching each call site,
means no future entry point can reintroduce the gap by forgetting to add its own check.

## File tree keyboard navigation (`VirtualList`)

`VirtualList` (`packages/ui/src/components/virtual-list.tsx`) carries `role="listbox"`/`role="option"`
— a promise to assistive tech that arrow keys move a roving selection. It now keeps that promise:

- **Arrow Up/Down** move a roving active index by one, clamped to the list.
- **Home/End** jump to the first/last item.
- **Enter/Space** call the new `onActivate(item, index)` prop for whichever row is active.
- The active row is scrolled into view (`virtualizer.scrollToIndex`) on every move, so navigation
  works past whatever the virtualizer currently has rendered.
- `aria-activedescendant` on the container announces the active row; a visible ring on the active
  row appears only while the list itself has focus (`group-focus:`), separate from `isSelected`'s
  own styling.

Rows are no longer individual tab stops — `FileTree`'s `TreeRow` sets `tabIndex={-1}`, so the
`VirtualList` container is the single stop, the same way a native `<select>` behaves. A mouse click
still activates a row directly and syncs the roving index to match.

## Recent Project stale-folder error

`workspace-service.ts`'s `open()` used to call `statSync` unwrapped — a deleted, moved, or renamed
recent project threw a raw `ENOENT` that the IPC router redacts to "Something went wrong handling
that action." It now routes through the same `fsTry`/`toFsError` translation layer every other
filesystem operation in the app uses, producing a precise, actionable message — using the folder's
basename only, never its absolute path (an absolute path is user data, never sent to the renderer).

## Empty workspace state

`FileTree` renders an explicit "No visible files" state (folder is empty, or everything is
`.gitignore`d) instead of a blank pane indistinguishable from "still loading" or "broken."

## Directory-expand loading indicator

`TreeRow` shows a spinning `RefreshIcon` in place of the chevron while a directory's children are
being fetched (`TreeNode.loading`, already tracked in the store but never rendered before).

## Testing

`workspace-store.test.ts` (the `pendingAction` gate for `openPath`/`close`), `workspace-switch-guard.test.tsx`
(dialog copy and confirm/cancel wiring), `virtual-list.test.tsx` (Arrow/Home/End/Enter/Space, clamping,
empty-list safety), `file-tree.test.tsx` (empty state, loading indicator, `tabIndex={-1}`, keyboard
activation, click still works), `workspace-service.test.ts` (stale-folder error content and that the
absolute path never leaks into it).
