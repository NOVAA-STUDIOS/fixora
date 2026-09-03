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

  it('shows a progress bar and percentage while available', () => {
    useUpdateStore.setState({ update: { status: 'available', version: '1.2.0' }, downloadProgress: 42 });
    const { container } = render(<UpdateBanner />);
    const bar = container.querySelector<HTMLDivElement>('div > div > div');
    expect(bar?.style.width).toBe('42%');
    expect(screen.getByText('42%')).toBeTruthy();
  });

  it('renders nothing once the download completes', () => {
    useUpdateStore.setState({
      update: { status: 'available', version: '1.2.0' },
      downloadProgress: 100,
    });
    render(<UpdateBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders nothing once downloaded — the status bar pill takes over', () => {
    useUpdateStore.setState({ update: { status: 'downloaded', version: '1.2.0' } });
    render(<UpdateBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
