import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
const revealAt = vi.hoisted(() => vi.fn());

vi.mock('../../lib/bridge.js', () => ({ invoke, subscribe: () => () => undefined }));
vi.mock('../workspace/workspace-store.js', () => ({
  useWorkspaceStore: (
    selector: (state: { workspace: { id: string } | null; revealAt: typeof revealAt }) => unknown,
  ) => selector({ workspace: { id: 'workspace-1' }, revealAt }),
}));

const { SearchPanel } = await import('./search-panel.js');

describe('SearchPanel empty results', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invoke.mockResolvedValue({ ok: true, value: { matches: [], truncated: false } });
  });

  it('explains empty results and lets the user clear the query', async () => {
    render(<SearchPanel />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search project files' }), {
      target: { value: 'missing-term' },
    });

    expect(await screen.findByText('No matches', {}, { timeout: 1500 })).toBeTruthy();
    expect(screen.getByText('Try another term or adjust the file filter.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('textbox', { name: 'Search project files' })).toHaveValue('');
    await waitFor(() => {
      expect(screen.getByText('Type at least 2 characters to search')).toBeTruthy();
    });
  });
});
