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

export type ActivityView =
  | 'workspace'
  | 'findings'
  | 'history'
  | 'suggestions'
  | 'settings'
  | 'diagnostics'
  | 'terminal'
  | 'search'
  | 'packages'
  | 'sourceControl';

/** One view's pane proportions, keyed by panel id. */
export type PaneSizes = Record<string, number>;
/** Pane proportions per activity view — a tree and a problems list want different widths. */
export type PanelLayout = Record<string, PaneSizes>;

const THEMES: readonly ThemeName[] = ['dark', 'light'];
const EDITOR_THEMES: readonly UiState['editorTheme'][] = ['fixora', 'monokai', 'solarized-dark'];
const DENSITIES: readonly DensityName[] = ['comfortable', 'compact'];
// `diagnostics` is deliberately absent from the activity rail — it is reachable from the
// command palette only. A debugging surface in the main navigation stops being one.
const VIEWS: readonly ActivityView[] = [
  'workspace',
  'findings',
  'history',
  'suggestions',
  'settings',
  'diagnostics',
  'terminal',
  'search',
  'packages',
  'sourceControl',
];

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
  for (const [view, sizes] of Object.entries(value)) {
    // A pre-existing store held a flat {panelId: number}; anything not shaped like the per-view
    // map is dropped rather than migrated, because a stale layout is worth exactly one relayout.
    if (typeof sizes !== 'object' || sizes === null) continue;
    const paneSizes: PaneSizes = {};
    for (const [pane, size] of Object.entries(sizes as Record<string, unknown>)) {
      if (typeof size === 'number' && Number.isFinite(size)) paneSizes[pane] = size;
    }
    if (Object.keys(paneSizes).length > 0) out[view] = paneSizes;
  }
  return out;
}

type UiState = {
  theme: ThemeName;
  density: DensityName;
  activeView: ActivityView;
  /** Not persisted — a palette open across restarts would be a bug, not a feature. */
  paletteOpen: boolean;
  /** The New Project modal. Not persisted — same reasoning as `paletteOpen`. */
  newProjectOpen: boolean;
  /**
   * The traditional side-by-side diff, opened on demand from the inline review.
   *
   * Inline review is the default surface, so this is off unless the user asks for it — and, like the
   * palette, it is deliberately NOT persisted: a modal restored over the editor on launch is a bug.
   */
  fullDiffOpen: boolean;
  openFullDiff: () => void;
  closeFullDiff: () => void;
  /** react-resizable-panels layout, keyed by panel id. Persisted so pane sizes survive restart. */
  panelLayout: PanelLayout;
  /**
   * Telemetry opt-in (FR-5). **Off by default** — telemetry is opt-in, anonymous and event-level,
   * never code or paths. No telemetry is sent in M2; this is the durable preference later
   * milestones read before sending anything.
   */
  telemetryEnabled: boolean;
  /**
   * Save an edited file automatically a moment after typing stops. **Off by default**: writing a
   * user's source file is not something to start doing without being asked, and an explicit Ctrl+S
   * is the behaviour every editor has trained people to expect.
   */
  autoSave: boolean;
  /** Run the workspace's own formatter (Prettier/Ruff) on the file after every explicit save. On
   * by default — unlike autoSave, this only ever fires on an action the user already took. */
  formatOnSave: boolean;
  /** The editor's own syntax-highlighting theme — independent of `theme` (the app chrome's
   * light/dark), the same way VS Code's colour theme picker is independent of its OS-appearance
   * follow setting. 'fixora' is the token-derived theme (`monaco-theme.ts`) that already follows
   * `theme`; the other two are fixed regardless of it, same as any named VS Code theme. */
  editorTheme: 'fixora' | 'monokai' | 'solarized-dark';
  /** On by default. */
  minimapEnabled: boolean;
  terminalFontSize: number;
  /** The view active before the last Ctrl+` switched to Terminal — what Ctrl+` switches BACK to.
   * Not persisted: a restart starting mid-toggle makes no sense. */
  lastNonTerminalView: ActivityView;
  /**
   * Reopen the last project on launch. **Off by default**: every launch starts on the Home screen
   * with a clean session, so a returning user is never dropped back into stale problems, a stale
   * assistant conversation, or a half-finished repair from a previous run. Opting in restores the
   * folder; it never restores analysis or repair state, which are always recomputed.
   */
  reopenLastProject: boolean;

  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
  setDensity: (density: DensityName) => void;
  toggleDensity: () => void;
  setActiveView: (view: ActivityView) => void;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  setNewProjectOpen: (open: boolean) => void;
  setPanelLayout: (view: string, sizes: PaneSizes) => void;
  setTelemetryEnabled: (enabled: boolean) => void;
  setAutoSave: (enabled: boolean) => void;
  setFormatOnSave: (enabled: boolean) => void;
  setEditorTheme: (theme: UiState['editorTheme']) => void;
  setMinimapEnabled: (enabled: boolean) => void;
  setTerminalFontSize: (size: number) => void;
  /** Ctrl+`, callable from anywhere: shows Terminal if it wasn't active, or switches back to
   * whatever was active before if it already was. */
  toggleTerminal: () => void;
  setReopenLastProject: (enabled: boolean) => void;
};

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      density: 'comfortable',
      activeView: 'workspace',
      paletteOpen: false,
      newProjectOpen: false,
      panelLayout: {},
      telemetryEnabled: false,
      autoSave: false,
      formatOnSave: true,
      editorTheme: 'fixora',
      minimapEnabled: true,
      terminalFontSize: 13,
      lastNonTerminalView: 'workspace',
      reopenLastProject: false,
      fullDiffOpen: false,

      openFullDiff: () => {
        set({ fullDiffOpen: true });
      },
      closeFullDiff: () => {
        set({ fullDiffOpen: false });
      },

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
      setNewProjectOpen: (newProjectOpen) => {
        set({ newProjectOpen });
      },
      setPanelLayout: (view, sizes) => {
        set((s) => ({ panelLayout: { ...s.panelLayout, [view]: sizes } }));
      },
      setTelemetryEnabled: (telemetryEnabled) => {
        set({ telemetryEnabled });
      },
      setAutoSave: (autoSave) => {
        set({ autoSave });
      },
      setFormatOnSave: (formatOnSave) => {
        set({ formatOnSave });
      },
      setEditorTheme: (editorTheme) => {
        set({ editorTheme });
      },
      setMinimapEnabled: (minimapEnabled) => {
        set({ minimapEnabled });
      },
      setTerminalFontSize: (terminalFontSize) => {
        // Clamped: unbounded growth via a stuck key repeat, or a corrupt persisted value, must not
        // scale the terminal past what the pane can render usefully.
        set({ terminalFontSize: Math.max(8, Math.min(32, terminalFontSize)) });
      },
      toggleTerminal: () => {
        const { activeView, lastNonTerminalView } = get();
        if (activeView === 'terminal') {
          set({ activeView: lastNonTerminalView });
        } else {
          set({ activeView: 'terminal', lastNonTerminalView: activeView });
        }
      },
      setReopenLastProject: (reopenLastProject) => {
        set({ reopenLastProject });
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
        autoSave: s.autoSave,
        formatOnSave: s.formatOnSave,
        editorTheme: s.editorTheme,
        minimapEnabled: s.minimapEnabled,
        terminalFontSize: s.terminalFontSize,
        reopenLastProject: s.reopenLastProject,
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
          // Same discipline: anything that is not explicitly `true` means "do not write the user's
          // files without being asked".
          autoSave: p.autoSave === true,
          // Was missing entirely, so the persisted value was dropped on every rehydration and the
          // toggle silently reset to off each launch. Same fail-closed rule: only an explicit true
          // opts in to reopening a project.
          reopenLastProject: p.reopenLastProject === true,
          // Defaults to true (unlike the two above): only an explicit persisted `false` opts out,
          // so a missing/corrupt value falls back to the feature's own default rather than off.
          formatOnSave: p.formatOnSave !== false,
          editorTheme: oneOf(p.editorTheme, EDITOR_THEMES, current.editorTheme),
          minimapEnabled: p.minimapEnabled !== false,
          terminalFontSize:
            typeof p.terminalFontSize === 'number' && p.terminalFontSize >= 8 && p.terminalFontSize <= 32
              ? p.terminalFontSize
              : current.terminalFontSize,
        };
      },
    },
  ),
);
