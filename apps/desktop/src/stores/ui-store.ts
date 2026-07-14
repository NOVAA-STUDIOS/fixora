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

type UiState = {
  theme: ThemeName;
  density: DensityName;
  activeView: ActivityView;
  /** Not persisted — a palette open across restarts would be a bug, not a feature. */
  paletteOpen: boolean;
  /** react-resizable-panels layout, keyed by panel id. Persisted so pane sizes survive restart. */
  panelLayout: PanelLayout;

  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
  setDensity: (density: DensityName) => void;
  toggleDensity: () => void;
  setActiveView: (view: ActivityView) => void;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  setPanelLayout: (layout: PanelLayout) => void;
};

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'dark',
      density: 'comfortable',
      activeView: 'workspace',
      paletteOpen: false,
      panelLayout: {},

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
    }),
    {
      name: 'fixora.ui',
      // Only durable facts are persisted. paletteOpen and (later) transient selection are not.
      partialize: (s) => ({
        theme: s.theme,
        density: s.density,
        activeView: s.activeView,
        panelLayout: s.panelLayout,
      }),
    },
  ),
);
