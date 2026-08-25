import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../lib/bridge.js', () => ({ invoke, subscribe: () => () => undefined }));

const { useUpdateStore } = await import('../../stores/update-store.js');
const { UpdateBanner } = await import('./update-banner.js');

/**
 * The downloading moment only. `idle` and `downloaded` must render nothing here — a user on the
 * latest build sees no auto-update UI at all, and "ready to restart" is the status bar's
 * `UpdateReadyPill` + modal now (`status-bar.tsx`), not this banner.
 */
beforeEach(() => {
  invoke.mockReset();
  useUpdateStore.setState({ update: { status: 'idle' }, downloadProgress: null });
});

describe('UpdateBanner', () => {
  it('renders nothing while idle', () => {
    render(<UpdateBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows "downloading" while available, with no action to take yet', () => {
    useUpdateStore.setState({ update: { status: 'available', version: '1.2.0' } });
    render(<UpdateBanner />);
    expect(screen.getByRole('status').textContent).toMatch(/1\.2\.0.*downloading/i);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows download percent once progress arrives', () => {
    useUpdateStore.setState({ update: { status: 'available', version: '1.2.0' }, downloadProgress: 42 });
    render(<UpdateBanner />);
    expect(screen.getByRole('status').textContent).toMatch(/42%/);
  });

  it('renders nothing once downloaded — the status bar pill takes over', () => {
    useUpdateStore.setState({ update: { status: 'downloaded', version: '1.2.0' } });
    render(<UpdateBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
