import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SPLASH_FADE_MS,
  SPLASH_HANG_TIMEOUT_MS,
  SPLASH_MESSAGES,
  SPLASH_MESSAGE_HOLD_MS,
  SPLASH_MIN_VISIBLE_MS,
  SPLASH_RETRY_MIN_MS,
  useSplash,
} from './use-splash.js';

/**
 * The splash's contract: it must not hide while work is running, must not linger once work is done
 * beyond the time the entrance animation needs to finish (no manufactured "premium" wait on top of
 * that), must hide its loading indicator the instant work resolves even if still up for that brief
 * remainder, and must never strand a user on a screen with no way forward.
 */

/** A promise plus the handles to settle it, so a test controls exactly when "init finishes". */
function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Advance timers and let the microtask queue drain, which promise callbacks need. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useSplash', () => {
  it('fades in rather than appearing at full opacity', async () => {
    const { promise } = deferred();
    const { result } = renderHook(() => useSplash(() => promise));

    // Mounted at the pre-transition phase so the fade has something to animate from.
    expect(result.current.state).toMatchObject({ visible: true, phase: 'entering' });
    await advance(50);
    expect(result.current.state).toMatchObject({ visible: true, phase: 'loading' });
  });

  it('stays visible for the animation-completion floor when initialization finishes instantly', async () => {
    const { promise, resolve } = deferred();
    const { result } = renderHook(() => useSplash(() => promise));

    await act(async () => {
      resolve();
      await promise;
    });

    // Work is done, but the floor (bounded, short — just long enough for the entrance animation to
    // finish) has not elapsed — the screen must still be up.
    await advance(SPLASH_MIN_VISIBLE_MS - 200);
    expect(result.current.state).toMatchObject({ visible: true, phase: 'loading' });

    await advance(200);
    expect(result.current.state).toMatchObject({ visible: true, phase: 'leaving' });

    await advance(SPLASH_FADE_MS);
    expect(result.current.state.visible).toBe(false);
  });

  it('the floor is bounded at roughly 1.5-2.5s, not a multi-second manufactured wait', () => {
    expect(SPLASH_MIN_VISIBLE_MS).toBeGreaterThanOrEqual(1500);
    expect(SPLASH_MIN_VISIBLE_MS).toBeLessThanOrEqual(2500);
  });

  it('stays visible past the floor while initialization is still running, however long that takes', async () => {
    const { promise, resolve } = deferred();
    const { result } = renderHook(() => useSplash(() => promise));

    // Well past the floor and still working: the floor is a minimum, never a schedule.
    await advance(SPLASH_MIN_VISIBLE_MS * 4);
    expect(result.current.state).toMatchObject({ visible: true, phase: 'loading' });

    await act(async () => {
      resolve();
      await promise;
    });
    await advance(1);
    expect(result.current.state).toMatchObject({ visible: true, phase: 'leaving' });
  });

  it('does not hold the user once the work is done and the floor has passed', async () => {
    const { promise, resolve } = deferred();
    const { result } = renderHook(() => useSplash(() => promise));

    await advance(SPLASH_MIN_VISIBLE_MS + 1000);
    await act(async () => {
      resolve();
      await promise;
    });
    // No extra floor is re-applied after a long init — it leaves on the next tick.
    await advance(1);
    expect(result.current.state).toMatchObject({ phase: 'leaving' });
  });

  it('shows an error without waiting out the floor, and never auto-dismisses it', async () => {
    const { promise, reject } = deferred();
    const { result } = renderHook(() => useSplash(() => promise));

    await act(async () => {
      reject(new Error('Could not list the workspace.'));
      await promise.catch(() => undefined);
    });

    expect(result.current.state).toMatchObject({
      visible: true,
      phase: 'error',
      errorMessage: 'Could not list the workspace.',
    });

    // Long past the floor, the error is still on screen — an infinite loader is exactly what a
    // failed launch must not become, and neither is an error that vanishes on its own.
    await advance(SPLASH_MIN_VISIBLE_MS * 4);
    expect(result.current.state).toMatchObject({ visible: true, phase: 'error' });
  });

  it('retries with a shorter floor, since the user is now actively waiting', async () => {
    let attempt = 0;
    const first = deferred();
    const second = deferred();
    const { result } = renderHook(() =>
      useSplash(() => {
        attempt += 1;
        return attempt === 1 ? first.promise : second.promise;
      }),
    );

    await act(async () => {
      first.reject(new Error('nope'));
      await first.promise.catch(() => undefined);
    });
    expect(result.current.state).toMatchObject({ phase: 'error' });

    act(() => {
      result.current.retry();
    });
    expect(attempt).toBe(2);
    await advance(50);
    expect(result.current.state).toMatchObject({ phase: 'loading', errorMessage: null });

    await act(async () => {
      second.resolve();
      await second.promise;
    });
    await advance(SPLASH_RETRY_MIN_MS);
    expect(result.current.state).toMatchObject({ phase: 'leaving' });
  });

  it('lets the user continue past a failure into the app', async () => {
    const { promise, reject } = deferred();
    const { result } = renderHook(() => useSplash(() => promise));

    await act(async () => {
      reject(new Error('nope'));
      await promise.catch(() => undefined);
    });

    act(() => {
      result.current.dismiss();
    });
    await advance(SPLASH_FADE_MS);
    expect(result.current.state.visible).toBe(false);
  });

  it('runs initialization exactly once per mount', async () => {
    const initialize = vi.fn(() => Promise.resolve());
    const { rerender } = renderHook(() => useSplash(initialize));
    await advance(50);
    rerender();
    rerender();
    // A splash that restarts the work it is waiting on would never finish.
    expect(initialize).toHaveBeenCalledTimes(1);
  });
});

/**
 * The loading indicator (req. 5) must reflect real work in progress, not the splash's own visibility
 * — it disappears the instant initialization resolves, even during the brief remainder of the
 * animation-completion floor.
 */
describe('the working flag (gates the loading indicator)', () => {
  it('is true while initialization has not resolved', async () => {
    const { promise } = deferred();
    const { result } = renderHook(() => useSplash(() => promise));
    await advance(50);
    expect(result.current.state).toMatchObject({ working: true });
  });

  it('flips to false the instant initialization resolves, even though the splash stays up for the floor', async () => {
    const { promise, resolve } = deferred();
    const { result } = renderHook(() => useSplash(() => promise));

    await act(async () => {
      resolve();
      await promise;
    });

    // Still visible (floor not elapsed) but no longer "working" — the spinner must be gone already.
    expect(result.current.state).toMatchObject({ visible: true, working: false });
    await advance(SPLASH_MIN_VISIBLE_MS);
  });

  it('is true again after a retry starts a fresh attempt', async () => {
    const first = deferred();
    const second = deferred();
    let attempt = 0;
    const { result } = renderHook(() =>
      useSplash(() => {
        attempt += 1;
        return attempt === 1 ? first.promise : second.promise;
      }),
    );

    await act(async () => {
      first.reject(new Error('nope'));
      await first.promise.catch(() => undefined);
    });
    act(() => {
      result.current.retry();
    });
    await advance(50);
    expect(result.current.state).toMatchObject({ working: true });
  });
});

/**
 * The status line makes claims about what the app is doing, so the claims have to be true. Two rules
 * govern it: a message is never shown before the work it names has happened, and "Ready" is never
 * shown until initialization has genuinely resolved.
 */
describe('progressive status messages', () => {
  it('starts on the first message', async () => {
    const { promise } = deferred();
    const { result } = renderHook(() => useSplash(() => promise));
    await advance(50);
    expect(result.current.state).toMatchObject({ message: SPLASH_MESSAGES[0] });
  });

  it('never runs ahead of the work, however long the clock has been ticking', async () => {
    const { promise } = deferred();
    // Reports nothing and never settles: the work has not progressed past step 0.
    const { result } = renderHook(() => useSplash(() => promise));

    await advance(SPLASH_MESSAGE_HOLD_MS * 10);
    // The clock would happily allow the last message; the work has not earned it.
    expect(result.current.state).toMatchObject({ message: SPLASH_MESSAGES[0] });
  });

  it('advances as real stages are reported, but not faster than they can be read', async () => {
    const { promise, resolve } = deferred();
    let report: ((stage: string) => void) | undefined;
    const { result } = renderHook(() =>
      useSplash((onStage) => {
        report = onStage;
        return promise;
      }),
    );

    await advance(50);
    // Both real stages complete almost immediately, as they do on a fast machine.
    act(() => {
      report?.('workspace');
      report?.('files');
    });

    // The work is at step 2, but the clock has only released step 1 — no strobing through strings.
    await advance(SPLASH_MESSAGE_HOLD_MS);
    expect(result.current.state).toMatchObject({ message: SPLASH_MESSAGES[1] });

    await advance(SPLASH_MESSAGE_HOLD_MS);
    expect(result.current.state).toMatchObject({ message: SPLASH_MESSAGES[2] });

    // And it stops there: "Ready" is not the clock's to give.
    await advance(SPLASH_MESSAGE_HOLD_MS * 5);
    expect(result.current.state).toMatchObject({ message: SPLASH_MESSAGES[2] });

    await act(async () => {
      resolve();
      await promise;
    });
    expect(result.current.state).toMatchObject({ message: 'Ready' });
  });

  it('never shows Ready while initialization is still running', async () => {
    const { promise, resolve } = deferred();
    let report: ((stage: string) => void) | undefined;
    const { result } = renderHook(() =>
      useSplash((onStage) => {
        report = onStage;
        return promise;
      }),
    );

    act(() => {
      report?.('workspace');
      report?.('files');
    });
    // Far beyond every hold and the floor itself — completion is not a thing time can assert.
    await advance(SPLASH_MIN_VISIBLE_MS * 4);
    expect(result.current.state).not.toMatchObject({ message: 'Ready' });

    await act(async () => {
      resolve();
      await promise;
    });
    expect(result.current.state).toMatchObject({ message: 'Ready' });
  });

  it('resets the sequence on retry rather than resuming mid-way', async () => {
    const first = deferred();
    const second = deferred();
    let attempt = 0;
    const { result } = renderHook(() =>
      useSplash((onStage) => {
        attempt += 1;
        if (attempt === 1) {
          onStage?.('workspace');
          return first.promise;
        }
        return second.promise;
      }),
    );

    await act(async () => {
      first.reject(new Error('nope'));
      await first.promise.catch(() => undefined);
    });

    act(() => {
      result.current.retry();
    });
    await advance(50);
    // Back to the beginning: the second attempt has not reported anything yet.
    expect(result.current.state).toMatchObject({ message: SPLASH_MESSAGES[0] });
  });
});

/**
 * The hang safety net (beta audit A1, Splash Screen finding 3): if `initialize()` never settles,
 * the splash must not become an infinite loader with no error and no way out. This only ever fires
 * on that one path — never on a genuinely slow-but-working machine, and never after the real promise
 * has already settled.
 */
describe('the hang safety net', () => {
  it('shows an error if initialization never settles within SPLASH_HANG_TIMEOUT_MS', async () => {
    const { promise } = deferred(); // never resolved or rejected in this test
    const { result } = renderHook(() => useSplash(() => promise));

    await advance(SPLASH_HANG_TIMEOUT_MS - 100);
    expect(result.current.state).toMatchObject({ visible: true, phase: 'loading' });

    await advance(200);
    expect(result.current.state).toMatchObject({
      visible: true,
      phase: 'error',
      errorMessage: expect.stringContaining('longer than expected') as string,
    });
  });

  it('never fires if initialization settles normally well before the timeout', async () => {
    const { promise, resolve } = deferred();
    const { result } = renderHook(() => useSplash(() => promise));

    await act(async () => {
      resolve();
      await promise;
    });
    await advance(SPLASH_MIN_VISIBLE_MS);
    expect(result.current.state).toMatchObject({ phase: 'leaving' });

    // Long past where the hang timer would have fired, had it not already been superseded by the
    // real completion — the splash must already be closed, not resurrected into an error.
    await advance(SPLASH_HANG_TIMEOUT_MS);
    expect(result.current.state.visible).toBe(false);
  });

  it('a late-arriving real result from a hung attempt is ignored once the user has retried', async () => {
    let attempt = 0;
    const first = deferred();
    const second = deferred();
    const { result } = renderHook(() =>
      useSplash(() => {
        attempt += 1;
        return attempt === 1 ? first.promise : second.promise;
      }),
    );

    // First attempt hangs past the safety net.
    await advance(SPLASH_HANG_TIMEOUT_MS);
    expect(result.current.state).toMatchObject({ phase: 'error' });

    // User retries — a second attempt begins while the first's promise is still technically pending.
    act(() => {
      result.current.retry();
    });
    await advance(50);
    expect(result.current.state).toMatchObject({ phase: 'loading', errorMessage: null });

    // The first attempt's promise finally settles late. It must be ignored — not allowed to stomp
    // the second attempt's in-progress state back to "leaving"/"done".
    await act(async () => {
      first.resolve();
      await first.promise;
    });
    await advance(1);
    expect(result.current.state).toMatchObject({ phase: 'loading' });

    // The second (current) attempt completing normally still works correctly.
    await act(async () => {
      second.resolve();
      await second.promise;
    });
    await advance(SPLASH_RETRY_MIN_MS);
    expect(result.current.state).toMatchObject({ phase: 'leaving' });
  });
});
