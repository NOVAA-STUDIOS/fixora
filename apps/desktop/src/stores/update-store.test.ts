import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Auto-update state, driven by main's two push events.
 *
 * `status: 'idle'` is what makes the banner (`update-banner.tsx`) render nothing before either
 * event has arrived, so a user who is already on the latest build sees no UI at all — the property
 * worth pinning is that the store starts and stays there until main actually says otherwise.
 */
const listeners: Record<string, ((payload: unknown) => void) | undefined> = {};
const subscribe = vi.fn((channel: string, listener: (payload: unknown) => void) => {
  listeners[channel] = listener;
  return () => {
    listeners[channel] = undefined;
  };
});

vi.mock('../lib/bridge.js', () => ({ invoke: vi.fn(), subscribe }));

const { useUpdateStore } = await import('./update-store.js');

beforeEach(() => {
  vi.clearAllMocks();
  useUpdateStore.setState({ update: { status: 'idle' } });
});

describe('useUpdateStore', () => {
  it('starts idle', () => {
    expect(useUpdateStore.getState().update).toEqual({ status: 'idle' });
  });

  it('setAvailable moves to the available state with the version', () => {
    useUpdateStore.getState().setAvailable('1.2.0');
    expect(useUpdateStore.getState().update).toEqual({ status: 'available', version: '1.2.0' });
  });

  it('setDownloaded supersedes available outright', () => {
    useUpdateStore.getState().setAvailable('1.2.0');
    useUpdateStore.getState().setDownloaded('1.2.0');
    expect(useUpdateStore.getState().update).toEqual({ status: 'downloaded', version: '1.2.0' });
  });

  it('listen subscribes to both events and applies their payloads', () => {
    const off = useUpdateStore.getState().listen();

    expect(subscribe).toHaveBeenCalledWith('update:available', expect.any(Function));
    expect(subscribe).toHaveBeenCalledWith('update:downloaded', expect.any(Function));

    listeners['update:available']?.({ version: '2.0.0' });
    expect(useUpdateStore.getState().update).toEqual({ status: 'available', version: '2.0.0' });

    listeners['update:downloaded']?.({ version: '2.0.0' });
    expect(useUpdateStore.getState().update).toEqual({ status: 'downloaded', version: '2.0.0' });

    off();
    expect(listeners['update:available']).toBeUndefined();
    expect(listeners['update:downloaded']).toBeUndefined();
  });
});
