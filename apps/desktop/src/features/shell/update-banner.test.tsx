import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../lib/bridge.js', () => ({ invoke, subscribe: () => () => undefined }));

const { useUpdateStore } = await import('../../stores/update-store.js');
const { UpdateBanner } = await import('./update-banner.js');

/**
 * Two moments, and nothing shown in between.
 *
 * `idle` must render nothing — a user on the latest build should never see auto-update as a UI
 * element at all — and only `downloaded` may offer the Restart button, since that is the one
 * moment `update:install` is safe to send (main hasn't finished downloading before it).
 */
beforeEach(() => {
  invoke.mockReset();
  useUpdateStore.setState({ update: { status: 'idle' } });
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

  it('offers Restart once downloaded, and it calls update:install', () => {
    useUpdateStore.setState({ update: { status: 'downloaded', version: '1.2.0' } });
    render(<UpdateBanner />);
    expect(screen.getByRole('status').textContent).toMatch(/1\.2\.0/);
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(invoke).toHaveBeenCalledWith('update:install', {});
  });
});
