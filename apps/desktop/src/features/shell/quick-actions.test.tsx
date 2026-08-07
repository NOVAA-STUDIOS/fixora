import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Quick Actions row (Sprint F2: Welcome Experience) — Open folder, Open recent, Documentation,
 * What's New. Open folder delegates to the workspace store (already covered by
 * `workspace-store.test.ts`); this file covers the three things that are new here: the recent
 * popover's lazy fetch and empty state, and that Documentation/What's New open their dialogs.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../lib/bridge.js', () => ({ invoke, subscribe: () => () => undefined }));

const pickAndOpen = vi.hoisted(() => vi.fn());
const openPath = vi.hoisted(() => vi.fn());
vi.mock('../workspace/workspace-store.js', () => ({
  useWorkspaceStore: (selector: (s: { pickAndOpen: () => void; openPath: () => void }) => unknown) =>
    selector({ pickAndOpen, openPath }),
}));

const { QuickActions } = await import('./quick-actions.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('QuickActions', () => {
  it('Open folder delegates to the workspace store', async () => {
    render(<QuickActions />);
    await userEvent.click(screen.getByRole('button', { name: 'Open folder' }));
    expect(pickAndOpen).toHaveBeenCalledTimes(1);
  });

  it('Open recent lazily fetches the list only once the popover opens', async () => {
    render(<QuickActions />);
    expect(invoke).not.toHaveBeenCalled();

    invoke.mockResolvedValueOnce({
      ok: true,
      value: {
        workspaces: [
          { id: 'w1', rootPath: '/repo/a', name: 'project-a', lastOpenedAt: 1, pinnedAt: null },
        ],
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Open recent' }));

    expect(await screen.findByText('project-a')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('workspace:recent', {});
  });

  it('Open recent shows a helpful empty state when there is nothing to reopen', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { workspaces: [] } });
    render(<QuickActions />);
    await userEvent.click(screen.getByRole('button', { name: 'Open recent' }));
    expect(await screen.findByText(/no recent projects yet/i)).toBeTruthy();
  });

  it('clicking a recent project in the popover opens it and closes the popover', async () => {
    invoke.mockResolvedValueOnce({
      ok: true,
      value: {
        workspaces: [
          { id: 'w1', rootPath: '/repo/a', name: 'project-a', lastOpenedAt: 1, pinnedAt: null },
        ],
      },
    });
    render(<QuickActions />);
    await userEvent.click(screen.getByRole('button', { name: 'Open recent' }));
    await userEvent.click(await screen.findByText('project-a'));

    expect(openPath).toHaveBeenCalledWith('/repo/a');
    await waitFor(() => {
      expect(screen.queryByText('project-a')).toBeNull();
    });
  });

  it('Documentation opens the in-app documentation dialog', async () => {
    render(<QuickActions />);
    await userEvent.click(screen.getByRole('button', { name: 'Documentation' }));
    expect(await screen.findByRole('heading', { name: 'Documentation' })).toBeTruthy();
  });

  it("What's new opens the in-app highlights dialog", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === 'system:getChangelog') return Promise.resolve({ ok: true, value: { releases: [] } });
      return Promise.resolve({ ok: true, value: { version: '0.9.0-beta.1' } });
    });
    render(<QuickActions />);
    await userEvent.click(screen.getByRole('button', { name: "What's new" }));
    expect(await screen.findByRole('heading', { name: "What's new" })).toBeTruthy();
  });
});
