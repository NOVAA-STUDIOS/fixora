import type { DensityName, ThemeName } from '@fixora/tokens';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * The client-state owner (ADR-015): "anything the user clicked" — theme, density, which activity
 * view is active, whether the command palette is open, and the persisted panel layout. It does
 * **not** own anything that came over a wire (that is TanStack Query, from M4) or any editor text
 * (that is Monaco, from M2). One owner per fact; no mirroring.
 *
 * Persistence is `localStorage` for M1. In M2 the durable slice (theme, density, layout) moves to
 * SQLite — "anything that must survive a restart" — but the *shape* here already separates the
 * persisted keys from the ephemeral ones (`paletteOpen` is not persisted), so that move is a
 * storage swap, not a redesign.
 */

export type ActivityView = 'workspace' | 'findings' | 'history' | 'settings';

export type PanelLayout = Record<string, number>;

const THEMES: readonly ThemeName[] = ['dark', 'light'];
const DENSITIES: readonly DensityName[] = ['comfortable', 'compact'];
const VIEWS: readonly ActivityView[] = ['workspace', 'findings', 'history', 'settings'];

/**
 * Coerce a rehydrated persisted value back to a valid one. localStorage survives across app
 * versions and is writable by a compromised renderer, so its contents are **untrusted input** on
 * every launch — a stale `activeView` from a renamed view, or a tampered value, must not reach a
 * lookup that assumes it is valid. "A corrupted local store degrades; it does not crash the app"
 * (DB §1) applies to this store just as it does to SQLite.
 */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function sanitizeLayout(value: unknown): PanelLayout {
  if (typeof value !== 'object' || value === null) return {};
  const out: PanelLayout = {};
  for (const [key, size] of Object.entries(value)) {
    if (typeof size === 'number' && Number.isFinite(size)) out[key] = size;
  }
  return out;
}

type UiState = {
  theme: ThemeName;
  density: DensityName;
  activeView: ActivityView;
  /** Not persisted — a palette open across restarts would be a bug, not a feature. */
  paletteOpen: boolean;
  /** react-resizable-panels layout, keyed by panel id. Persisted so pane sizes survive restart. */
  panelLayout: PanelLayout;
  /**
   * Telemetry opt-in (FR-5). **Off by default** — telemetry is opt-in, anonymous and event-level,
   * never code or paths. No telemetry is sent in M2; this is the durable preference later
   * milestones read before sending anything.
   */
  telemetryEnabled: boolean;

  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
  setDensity: (density: DensityName) => void;
  toggleDensity: () => void;
  setActiveView: (view: ActivityView) => void;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  setPanelLayout: (layout: PanelLayout) => void;
  setTelemetryEnabled: (enabled: boolean) => void;
};

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'dark',
      density: 'comfortable',
      activeView: 'workspace',
      paletteOpen: false,
      panelLayout: {},
      telemetryEnabled: false,

      setTheme: (theme) => {
        set({ theme });
      },
      toggleTheme: () => {
        set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' }));
      },
      setDensity: (density) => {
        set({ density });
      },
      toggleDensity: () => {
        set((s) => ({ density: s.density === 'comfortable' ? 'compact' : 'comfortable' }));
      },
      setActiveView: (activeView) => {
        set({ activeView });
      },
      setPaletteOpen: (paletteOpen) => {
        set({ paletteOpen });
      },
      togglePalette: () => {
        set((s) => ({ paletteOpen: !s.paletteOpen }));
      },
      setPanelLayout: (panelLayout) => {
        set({ panelLayout });
      },
      setTelemetryEnabled: (telemetryEnabled) => {
        set({ telemetryEnabled });
      },
    }),
    {
      name: 'fixora.ui',
      // Only durable facts are persisted. paletteOpen and (later) transient selection are not.
      partialize: (s) => ({
        theme: s.theme,
        density: s.density,
        activeView: s.activeView,
        panelLayout: s.panelLayout,
        telemetryEnabled: s.telemetryEnabled,
      }),
      // Rehydration is the trust boundary for persisted state (see `oneOf` above). Every value
      // read back from localStorage is validated against the current known-good set before it
      // enters the store, so a stale-after-upgrade or tampered value degrades to a default rather
      // than crashing a lookup downstream.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UiState>;
        return {
          ...current,
          theme: oneOf(p.theme, THEMES, current.theme),
          density: oneOf(p.density, DENSITIES, current.density),
          activeView: oneOf(p.activeView, VIEWS, current.activeView),
          panelLayout: sanitizeLayout(p.panelLayout),
          // Any non-`true` persisted value falls back to opt-OUT — telemetry is off unless the
          // stored value is explicitly the boolean true (FR-5).
          telemetryEnabled: p.telemetryEnabled === true,
        };
      },
    },
  ),
);
