import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SPLASH_FADE_MS,
  SPLASH_MESSAGES,
  SPLASH_MESSAGE_HOLD_MS,
  SPLASH_MIN_VISIBLE_MS,
  SPLASH_RETRY_MIN_MS,
  useSplash,
} from './use-splash.js';

/**
 * The splash's contract, which is entirely about timing and therefore entirely worth testing: it
 * must not hide while work is running, must not linger once work is done, and must never strand a
 * user on a screen with no way forward.
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

  it('stays visible for the full floor when initialization finishes immediately', async () => {
    const { promise, resolve } = deferred();
    const { result } = renderHook(() => useSplash(() => promise));

    await act(async () => {
      resolve();
      await promise;
    });

    // Work is done, but the floor has not elapsed — the screen must still be readable.
    await advance(SPLASH_MIN_VISIBLE_MS - 200);
    expect(result.current.state).toMatchObject({ visible: true, phase: 'loading' });

    await advance(200);
    expect(result.current.state).toMatchObject({ visible: true, phase: 'leaving' });

    await advance(SPLASH_FADE_MS);
    expect(result.current.state.visible).toBe(false);
  });

  it('stays visible past the floor while initialization is still running', async () => {
    const { promise, resolve } = deferred();
    const { result } = renderHook(() => useSplash(() => promise));

    // Well past the floor and still working: the floor is a minimum, never a schedule.
    await advance(SPLASH_MIN_VISIBLE_MS * 2);
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
    await advance(SPLASH_FADE_MS);

    expect(result.current.state).toMatchObject({
      visible: true,
      phase: 'error',
      errorMessage: 'Could not list the workspace.',
    });

    // Long past the floor, the error is still on screen — an infinite loader is exactly what a
    // failed launch must not become, and neither is an error that vanishes on its own.
    await advance(SPLASH_MIN_VISIBLE_MS * 3);
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
    await advance(SPLASH_FADE_MS);
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
    await advance(SPLASH_FADE_MS);

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
    await advance(SPLASH_FADE_MS);

    act(() => {
      result.current.retry();
    });
    await advance(50);
    // Back to the beginning: the second attempt has not reported anything yet.
    expect(result.current.state).toMatchObject({ message: SPLASH_MESSAGES[0] });
  });
});
