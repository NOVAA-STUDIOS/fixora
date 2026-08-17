import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Beta audit A1 (Splash Screen finding 1 / Keyboard Navigation finding 1): the splash is a plain
 * overlay div, not a Radix dialog, so nothing else stopped a keyboard/screen-reader user from
 * tabbing into the fully interactive (but visually covered) shell behind it. `App` now marks that
 * shell `inert` for as long as the splash is visible. This test proves the fix without mounting the
 * real, heavy `AppShell` — a stub with one real button stands in for "the rest of the app."
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../lib/bridge.js', () => ({ invoke, subscribe: () => () => undefined }));

vi.mock('../features/shell/app-shell.js', () => ({
  AppShell: () => <button type="button">Real app button</button>,
}));

// Auth gate: this suite is about splash/inert behaviour, not sign-in, so a signed-in user is
// stubbed in — otherwise `App` would render `LoginScreen` instead of the shell under test.
vi.mock('../features/auth/auth-store.js', () => ({
  useAuthStore: (selector: (s: { loading: boolean; user: object; getSession: () => Promise<void> }) => unknown) =>
    selector({ loading: false, user: {}, getSession: () => Promise.resolve() }),
}));

vi.mock('../hooks/use-appearance.js', () => ({ useAppearance: () => undefined }));
vi.mock('../features/workspace/use-file-watch.js', () => ({ useFileWatch: () => undefined }));

const hydrateCurrent = vi.hoisted(() => vi.fn());
vi.mock('../features/workspace/workspace-store.js', () => ({
  useWorkspaceStore: (selector: (s: { hydrateCurrent: typeof hydrateCurrent }) => unknown) =>
    selector({ hydrateCurrent }),
}));

const { App } = await import('./App.js');

beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue({ ok: true, value: { version: '0.9.0-beta.1' } });
});

describe('App — splash focus containment', () => {
  it('marks the app shell inert while the splash is visible', () => {
    // Never resolves within this test — the splash stays up for its whole duration.
    hydrateCurrent.mockReturnValue(new Promise(() => undefined));
    render(<App />);

    const button = screen.getByRole('button', { name: 'Real app button' });
    // `inert` is reflected onto the DOM element itself.
    expect(button.closest('[inert]')).not.toBeNull();
  });

  it('removes inert once initialization resolves and the splash closes', async () => {
    vi.useFakeTimers();
    try {
      hydrateCurrent.mockResolvedValue(undefined);
      render(<App />);

      const button = screen.getByRole('button', { name: 'Real app button' });
      expect(button.closest('[inert]')).not.toBeNull();

      // Let the resolved `hydrateCurrent` promise's microtask run, then the splash's bounded
      // animation-completion floor (use-splash.ts) plus its closing fade.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(2200);
        await Promise.resolve();
      });

      expect(button.closest('[inert]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
