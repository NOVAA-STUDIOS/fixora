import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * GPU compositing preference (Windows only — see `index.ts`). Some Windows GPU drivers never
 * composite the first frame of a frameless, deferred-show window: Chromium paints the DOM but the
 * window keeps showing its background colour until a resize forces a recomposite, which reads to
 * the user as a black screen on launch. Disabling *compositing* (not rasterisation) works around
 * it, but costs every OTHER user's rendering smoothness if applied unconditionally — so this store
 * makes the decision per-machine instead of per-build.
 *
 * The default path tries WITH compositing enabled. If a launch never reaches the renderer's first
 * paint (`ready-to-show`) before the app exits — a crash or a hang, the same failure mode a black
 * screen is a symptom of — the NEXT launch treats that as evidence and disables compositing from
 * then on. A user who still sees a black screen despite that (a driver that renders nothing on
 * screen but doesn't crash either) can also flip it manually in Settings.
 */
export interface GpuPreferenceStore {
  /** Whether this launch should disable compositing. */
  shouldDisableCompositing(): boolean;
  /** Call once, before the window is created, when this launch is trying WITH compositing on —
   * records "a launch was attempted" so a launch that never confirms is evidence of a bad one. */
  markLaunchPending(): void;
  /** Call on the renderer's first paint (`ready-to-show`) — clears the pending marker. */
  markLaunchConfirmed(): void;
  /** The user's explicit Settings choice. Takes effect on the next launch. */
  setUserPreference(disabled: boolean): void;
}

interface StoredState {
  disableCompositing: boolean;
  pendingLaunch: boolean;
}

export function createGpuPreferenceStore(
  dir: string,
  fileName = 'gpu-preference.json',
): GpuPreferenceStore {
  const file = join(dir, fileName);

  function load(): StoredState {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredState>;
      return {
        disableCompositing: parsed.disableCompositing === true,
        pendingLaunch: parsed.pendingLaunch === true,
      };
    } catch {
      return { disableCompositing: false, pendingLaunch: false };
    }
  }

  function save(next: StoredState): void {
    try {
      writeFileSync(file, JSON.stringify(next), 'utf8');
    } catch {
      // Best-effort: a failed write just means the next launch re-decides from load()'s fallback,
      // never a reason to refuse to launch over a preference file.
    }
  }

  const state = load();
  // A launch that started with compositing on and never reached `markLaunchConfirmed` before this
  // one started is the signal: auto-detect it here, once, at construction, and persist immediately
  // so it survives even if this launch also fails before writing again.
  if (state.pendingLaunch && !state.disableCompositing) {
    state.disableCompositing = true;
    state.pendingLaunch = false;
    save(state);
  }

  return {
    shouldDisableCompositing: () => state.disableCompositing,
    markLaunchPending: () => {
      state.pendingLaunch = true;
      save(state);
    },
    markLaunchConfirmed: () => {
      if (!state.pendingLaunch) return;
      state.pendingLaunch = false;
      save(state);
    },
    setUserPreference: (disabled) => {
      state.disableCompositing = disabled;
      state.pendingLaunch = false;
      save(state);
    },
  };
}
