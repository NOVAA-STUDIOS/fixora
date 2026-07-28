import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Composition smoke test for the Welcome/Home screen (Sprint F2): the hero, Quick Actions, and
 * Recent Projects mount together as one surface, and the primary CTA still reaches the workspace
 * store. Each piece's own behaviour is covered in its own test file; this one proves they assemble.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../lib/bridge.js', () => ({ invoke, subscribe: () => () => undefined }));

const pickAndOpen = vi.hoisted(() => vi.fn());
vi.mock('../workspace/workspace-store.js', () => ({
  useWorkspaceStore: (
    selector: (s: {
      pickAndOpen: () => void;
      opening: boolean;
      error: string | null;
      openPath: () => void;
    }) => unknown,
  ) => selector({ pickAndOpen, opening: false, error: null, openPath: vi.fn() }),
}));

const { HomeScreen } = await import('./home-screen.js');

beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue({ ok: true, value: { workspaces: [] } });
});

describe('HomeScreen', () => {
  it('renders the hero, Quick Actions, and Recent Projects together', async () => {
    render(<HomeScreen />);
    expect(screen.getByRole('heading', { name: 'Fixora' })).toBeTruthy();
    // "Open folder" appears twice by design: the hero CTA and the Quick Actions row entry.
    expect(screen.getAllByRole('button', { name: /open folder/i })).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'Quick actions' })).toBeTruthy();
    expect(await screen.findByText('No recent projects')).toBeTruthy();
  });

  it('the hero Open folder button opens the workspace picker', async () => {
    render(<HomeScreen />);
    const [hero] = screen.getAllByRole('button', { name: /open folder/i });
    await userEvent.click(hero!);
    expect(pickAndOpen).toHaveBeenCalledTimes(1);
  });
});
