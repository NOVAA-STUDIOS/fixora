import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../lib/bridge.js', () => ({ invoke, subscribe: () => () => undefined }));

const { WhatsNewDialog } = await import('./whats-new-dialog.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WhatsNewDialog', () => {
  it('does not fetch the app version while closed', () => {
    render(<WhatsNewDialog open={false} onOpenChange={vi.fn()} />);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('fetches and displays the running build version, separate from the highlights list', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { version: '0.9.0-beta.1' } });
    render(<WhatsNewDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByText('Running v0.9.0-beta.1')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('system:getAppInfo', {});
  });

  it('renders the highlight list', () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { version: '0.9.0-beta.1' } });
    render(<WhatsNewDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByRole('heading', { name: "What's new" })).toBeTruthy();
    expect(screen.getByText('Welcome Experience')).toBeTruthy();
    expect(screen.getByText('Suggestion System')).toBeTruthy();
  });

  it('does not claim the running version contains the highlights below it (beta audit A1, finding 1)', () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { version: '0.9.0-beta.1' } });
    render(<WhatsNewDialog open onOpenChange={vi.fn()} />);
    // The description must never read like "Current build: vX" directly above the list — several
    // highlights are unreleased, post-tag work, not part of any tagged version yet.
    expect(screen.queryByText(/current build/i)).toBeNull();
    expect(screen.getByText('Recent highlights from across Fixora.')).toBeTruthy();
  });
});
