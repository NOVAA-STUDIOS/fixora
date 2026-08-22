import { useEffect, useState } from 'react';

import { invoke } from '../../lib/bridge.js';
import { useLicenseStore } from '../../stores/license-store.js';

/**
 * How long until the repair window rolls over, as a label.
 *
 * `resetsAt` comes from MAIN (`license:getRepairCount`), never from the renderer's own copy: main
 * owns the window, and a countdown computed from a second, drifting source would confidently show
 * the wrong time. Re-fetched rather than recomputed locally so it stays right across a reset.
 */
export function formatCountdown(msRemaining: number): string {
  // A non-finite input renders as the literal string "NaN" in the label if left alone. Nothing
  // useful can be said about an unknown deadline, so say nothing.
  if (!Number.isFinite(msRemaining)) return '';
  if (msRemaining <= 0) return 'Resetting…';
  const totalMinutes = Math.ceil(msRemaining / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `Resets in ${String(minutes)}m`;
  return `Resets in ${String(hours)}h ${String(minutes)}m`;
}

export function useResetCountdown(): string | null {
  const [resetsAt, setResetsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // The preload bridge is absent in tests (and would be on any surface rendered before it
    // loads). This hook only decorates a label, so it must degrade to "no countdown" rather than
    // throw and take its host component down with it.
    if (typeof window === 'undefined' || (window.fixora as unknown) === undefined) return;

    let cancelled = false;
    const load = (): void => {
      void invoke('license:getRepairCount', {}).then((result) => {
        if (cancelled || !result.ok) return;
        // Rejected at the boundary rather than stored and formatted later — a bad value here would
        // otherwise reappear as an empty label with no clue where it came from.
        if (!Number.isFinite(result.value.resetsAt)) {
          console.error('[license] ignoring non-finite resetsAt', { resetsAt: result.value.resetsAt });
          return;
        }
        setResetsAt(result.value.resetsAt);
        // The same response carries the authoritative count, so the store is refreshed from it
        // rather than issuing a second identical round trip.
        useLicenseStore.setState({ repairsToday: result.value.repairsToday });
      });
    };
    load();
    // A minute is the resolution the label actually shows, so anything finer is wasted work. The
    // re-fetch on the same tick is what picks up a rollover: once the window resets, main returns a
    // new `resetsAt` and the countdown starts again rather than sitting at "Resetting…".
    const timer = setInterval(() => {
      if (cancelled) return;
      setNow(Date.now());
      load();
    }, 60_000);
    // Returning to the app is the moment a stale count is most visible — and the moment another
    // instance (or a hand-edited file) is most likely to have changed it while this window was
    // in the background.
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, []);

  if (resetsAt === null) return null;
  // `null`, never an empty string: callers join this with a separator (`· ${countdown}`), and an
  // empty string would render a dangling bullet rather than nothing at all.
  const label = formatCountdown(resetsAt - now);
  return label === '' ? null : label;
}
