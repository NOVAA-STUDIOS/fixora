import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../lib/bridge.js', () => ({ invoke, subscribe: () => () => undefined }));

const { WhatsNewDialog, __resetChangelogCacheForTests } = await import('./whats-new-dialog.js');

beforeEach(() => {
  vi.clearAllMocks();
  __resetChangelogCacheForTests();
});

/** `system:getAppInfo` and `system:getChangelog` both fire on open — stub both by channel name
 * so call order doesn't matter and each test isn't tied to exactly two `invoke` calls. */
function mockInvoke(changelog: unknown = { ok: true, value: { releases: [] } }): void {
  invoke.mockImplementation((channel: string) => {
    if (channel === 'system:getAppInfo') {
      return Promise.resolve({ ok: true, value: { version: '0.9.0-beta.1' } });
    }
    if (channel === 'system:getChangelog') return Promise.resolve(changelog);
    return Promise.resolve({ ok: true, value: {} });
  });
}

describe('WhatsNewDialog', () => {
  it('does not fetch the app version while closed', () => {
    render(<WhatsNewDialog open={false} onOpenChange={vi.fn()} />);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('fetches and displays the running build version, separate from the highlights list', async () => {
    mockInvoke();
    render(<WhatsNewDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByText('Running v0.9.0-beta.1')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('system:getAppInfo', {});
  });

  it('renders the highlight list', () => {
    mockInvoke();
    render(<WhatsNewDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByRole('heading', { name: "What's new" })).toBeTruthy();
    expect(screen.getByText('Welcome Experience')).toBeTruthy();
    expect(screen.getByText('Suggestion System')).toBeTruthy();
  });

  it('does not claim the running version contains the highlights below it (beta audit A1, finding 1)', () => {
    mockInvoke();
    render(<WhatsNewDialog open onOpenChange={vi.fn()} />);
    // The description must never read like "Current build: vX" directly above the list — several
    // highlights are unreleased, post-tag work, not part of any tagged version yet.
    expect(screen.queryByText(/current build/i)).toBeNull();
    expect(screen.getByText('Recent highlights from across Fixora.')).toBeTruthy();
  });

  it('fetches and renders GitHub release notes', async () => {
    mockInvoke({
      ok: true,
      value: { releases: [{ version: 'v1.2.0', date: '2026-01-01', body: 'Fixed bugs.' }] },
    });
    render(<WhatsNewDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByText('v1.2.0')).toBeTruthy();
    expect(screen.getByText('Fixed bugs.')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('system:getChangelog', {});
  });

  it('shows a fallback when there are no releases', async () => {
    mockInvoke({ ok: true, value: { releases: [] } });
    render(<WhatsNewDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByText('No release notes available.')).toBeTruthy();
  });

  it('shows an error state when the fetch fails', async () => {
    mockInvoke({ ok: false, error: { message: 'offline' } });
    render(<WhatsNewDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
