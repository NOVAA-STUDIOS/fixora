import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../lib/bridge.js', () => ({ invoke, subscribe: () => () => undefined }));

const { WhatsNewDialog, __resetChangelogCacheForTests } = await import('./whats-new-dialog.js');

beforeEach(() => {
  vi.clearAllMocks();
  __resetChangelogCacheForTests();
});

/** `system:getChangelog` fires on open — stub by channel name so a stray call to anything else
 * doesn't crash the test. */
function mockInvoke(changelog: unknown = { ok: true, value: { releases: [] } }): void {
  invoke.mockImplementation((channel: string) => {
    if (channel === 'system:getChangelog') return Promise.resolve(changelog);
    return Promise.resolve({ ok: true, value: {} });
  });
}

describe('WhatsNewDialog', () => {
  it('does not fetch release notes while closed', () => {
    render(<WhatsNewDialog open={false} onOpenChange={vi.fn()} />);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('shows the heading and only the release notes section — no highlights list', () => {
    mockInvoke();
    render(<WhatsNewDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByRole('heading', { name: "What's new" })).toBeTruthy();
    expect(screen.queryByText('Welcome Experience')).toBeNull();
    expect(screen.getByText('Release notes')).toBeTruthy();
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
