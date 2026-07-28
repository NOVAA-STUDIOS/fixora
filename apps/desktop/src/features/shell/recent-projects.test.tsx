import type { WorkspaceInfo } from '@fixora/shared-types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Renderer-side coverage for pin support on the Recent Projects list (Sprint F2: Welcome
 * Experience). The rest of the component's existing behaviour (remove, clear-all, reveal, copy
 * path) predates this sprint and is exercised by manual verification + the main-process handler
 * tests; this file focuses on what's new — pin/unpin — using the same IPC-mock-at-the-boundary
 * pattern as `suggestion-panel.test.tsx`.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../lib/bridge.js', () => ({ invoke, subscribe: () => () => undefined }));

vi.mock('../workspace/workspace-store.js', () => ({
  useWorkspaceStore: (selector: (s: { openPath: () => void; opening: boolean }) => unknown) =>
    selector({ openPath: vi.fn(), opening: false }),
}));

const { RecentProjects } = await import('./recent-projects.js');

const unpinned: WorkspaceInfo = {
  id: 'w1',
  rootPath: '/repo/unpinned',
  name: 'unpinned-project',
  lastOpenedAt: Date.now(),
  pinnedAt: null,
};

const pinned: WorkspaceInfo = {
  id: 'w2',
  rootPath: '/repo/pinned',
  name: 'pinned-project',
  lastOpenedAt: Date.now() - 1000,
  pinnedAt: Date.now(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RecentProjects — pin support', () => {
  it('shows a "Pin project" action for an unpinned card and calls workspace:setPinned(true)', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { workspaces: [unpinned] } });
    render(<RecentProjects />);
    await screen.findByText('unpinned-project');

    invoke.mockResolvedValueOnce({ ok: true, value: { workspaces: [{ ...unpinned, pinnedAt: 1 }] } });
    await userEvent.click(screen.getByRole('button', { name: /pin unpinned-project/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('workspace:setPinned', { id: 'w1', pinned: true });
    });
  });

  it('shows an "Unpin" action for an already-pinned card and calls workspace:setPinned(false)', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { workspaces: [pinned] } });
    render(<RecentProjects />);
    await screen.findByText('pinned-project');

    invoke.mockResolvedValueOnce({ ok: true, value: { workspaces: [{ ...pinned, pinnedAt: null }] } });
    await userEvent.click(screen.getByRole('button', { name: /unpin pinned-project/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('workspace:setPinned', { id: 'w2', pinned: false });
    });
  });

  it('renders pinned projects ahead of unpinned ones, in the order the backend returns them', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { workspaces: [pinned, unpinned] } });
    render(<RecentProjects />);
    await screen.findByText('pinned-project');

    const names = screen.getAllByText(/-project$/).map((el) => el.textContent);
    expect(names).toEqual(['pinned-project', 'unpinned-project']);
  });

  /** Beta audit A1, Recent Projects: pinning 6+ projects hid every unpinned recent, with no other
   *  way to reach it from the Home screen. `shownWorkspaces` now reserves slots for unpinned. */
  it('still shows at least two unpinned projects even when six or more are pinned', async () => {
    const manyPinned: WorkspaceInfo[] = Array.from({ length: 8 }, (_, i) => ({
      id: `pinned-${String(i)}`,
      rootPath: `/repo/pinned-${String(i)}`,
      name: `pinned-${String(i)}`,
      lastOpenedAt: Date.now() - i,
      pinnedAt: Date.now() - i,
    }));
    const someUnpinned: WorkspaceInfo[] = Array.from({ length: 3 }, (_, i) => ({
      id: `unpinned-${String(i)}`,
      rootPath: `/repo/unpinned-${String(i)}`,
      name: `unpinned-${String(i)}`,
      lastOpenedAt: Date.now() - i,
      pinnedAt: null,
    }));

    invoke.mockResolvedValueOnce({
      ok: true,
      value: { workspaces: [...manyPinned, ...someUnpinned] },
    });
    render(<RecentProjects />);
    await screen.findByText('pinned-0');

    const shownUnpinned = someUnpinned.filter((w) => screen.queryByText(w.name) !== null);
    expect(shownUnpinned.length).toBeGreaterThanOrEqual(2);
  });

  it('shows a visible "More actions" trigger exposing Reveal/Copy path (no longer right-click-only)', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { workspaces: [unpinned] } });
    render(<RecentProjects />);
    await screen.findByText('unpinned-project');

    await userEvent.click(screen.getByRole('button', { name: /more actions for unpinned-project/i }));
    expect(await screen.findByText('Reveal in File Explorer')).toBeTruthy();
    expect(screen.getByText('Copy path')).toBeTruthy();
  });

  it('no longer offers the disabled "Open in new window" stub', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { workspaces: [unpinned] } });
    render(<RecentProjects />);
    await screen.findByText('unpinned-project');

    await userEvent.click(screen.getByRole('button', { name: /more actions for unpinned-project/i }));
    await screen.findByText('Reveal in File Explorer');
    expect(screen.queryByText('Open in new window')).toBeNull();
  });
});
