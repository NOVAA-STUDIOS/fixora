import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingWorkspaceAction } from './workspace-store.js';

/**
 * The one shared "you have unsaved changes" confirmation for leaving the current workspace (beta
 * audit A2). Mounted once in `AppShell`; this test drives it directly against the store's
 * `pendingAction` state rather than through any particular entry point (Recent Projects, Quick
 * Actions, the Open menu all set the same field).
 */

let pendingAction: PendingWorkspaceAction | null = null;
let dirty: string[] = [];
const confirmPendingAction = vi.hoisted(() => vi.fn());
const cancelPendingAction = vi.hoisted(() => vi.fn());

vi.mock('./workspace-store.js', () => ({
  useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ pendingAction, confirmPendingAction, cancelPendingAction }),
}));
vi.mock('../editor/editor-store.js', () => ({
  useEditorStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ dirty }),
}));

const { WorkspaceSwitchGuard } = await import('./workspace-switch-guard.js');

beforeEach(() => {
  vi.clearAllMocks();
  pendingAction = null;
  dirty = [];
});

describe('WorkspaceSwitchGuard', () => {
  it('is closed when there is no pending action', () => {
    render(<WorkspaceSwitchGuard />);
    expect(screen.queryByText(/unsaved/i)).toBeNull();
  });

  it('shows "switch" copy for a blocked project switch', () => {
    pendingAction = { type: 'switch', path: '/other' };
    dirty = ['a.ts', 'b.ts'];
    render(<WorkspaceSwitchGuard />);
    expect(screen.getByText('Switch project without saving?')).toBeTruthy();
    expect(screen.getByText('2 files have unsaved changes. Switching projects discards them.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discard and switch' })).toBeTruthy();
  });

  it('shows "close" copy, and singular wording for one file, for a blocked close', () => {
    pendingAction = { type: 'close' };
    dirty = ['a.ts'];
    render(<WorkspaceSwitchGuard />);
    expect(screen.getByText('Close project without saving?')).toBeTruthy();
    expect(screen.getByText('1 file has unsaved changes. Closing discards them.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discard and close' })).toBeTruthy();
  });

  it('confirming calls confirmPendingAction', async () => {
    pendingAction = { type: 'switch', path: '/other' };
    dirty = ['a.ts'];
    render(<WorkspaceSwitchGuard />);
    await userEvent.click(screen.getByRole('button', { name: 'Discard and switch' }));
    expect(confirmPendingAction).toHaveBeenCalledTimes(1);
  });

  it('cancelling (Escape) calls cancelPendingAction, not confirmPendingAction', async () => {
    pendingAction = { type: 'switch', path: '/other' };
    dirty = ['a.ts'];
    render(<WorkspaceSwitchGuard />);
    await userEvent.keyboard('{Escape}');
    expect(cancelPendingAction).toHaveBeenCalledTimes(1);
    expect(confirmPendingAction).not.toHaveBeenCalled();
  });
});
