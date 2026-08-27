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

/**
 * Which job the workbench is laid out for.
 *
 * The same panels either way — this changes proportions and which one leads, not what exists, so
 * nothing is ever hidden from the user and no feature is gated behind a mode.
 *
 *  - `fix`  — Problems leads: the repair-focused layout Fixora has always opened in.
 *  - `code` — the editor leads: a narrow file tree and a minimal assistant pane, for the stretch
 *             where you are writing code rather than working through findings.
 */
export type WorkspaceMode = 'fix' | 'code';

/** One view's pane proportions, keyed by panel id. */
export type PaneSizes = Record<string, number>;
/** Pane proportions per activity view — a tree and a problems list want different widths. */
export type PanelLayout = Record<string, PaneSizes>;

const THEMES: readonly ThemeName[] = ['dark', 'light'];
const WORKSPACE_MODES: readonly WorkspaceMode[] = ['fix', 'code'];
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
  /** Which layout the workbench uses. Persisted — it is a working preference, not session state. */
  workspaceMode: WorkspaceMode;
  /**
   * Which tab the assistant pane shows (`workbench.tsx`'s EditModeTabs).
   *
   * Lifted out of `workbench.tsx`'s local state so a click in the Problems panel can switch to it:
   * running Explain and leaving the user on the Repair tab puts the answer they asked for somewhere
   * they are not looking. Not persisted — which tab you were on is session state.
   */
  editMode: 'repair' | 'proceed' | 'explain';
  setEditMode: (mode: 'repair' | 'proceed' | 'explain') => void;
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
  /** Watch Mode (off by default): re-analyze a file automatically when it's saved, instead of
   * waiting for an explicit Analyze click. Same "never act without being asked" default as
   * autoSave — this one runs analysis, not a write, but it's still unsolicited work on every
   * save until the user opts in. */
  watchModeEnabled: boolean;
  /** Whether the left (primary) pane is shown. CSS-collapsed, not unmounted, when false. */
  primaryPanelVisible: boolean;
  /** Whether the right (assistant) pane is shown. CSS-collapsed, not unmounted, when false. */
  aiPanelVisible: boolean;

  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
  setDensity: (density: DensityName) => void;
  toggleDensity: () => void;
  setActiveView: (view: ActivityView) => void;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
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
  setWatchModeEnabled: (enabled: boolean) => void;
  /** Resets appearance, editor and analysis settings to their shipped defaults. Deliberately narrow:
   *  providers, API keys, license and MCP settings live in their own stores and are never touched
   *  by this — see `settings-panel.tsx`'s "Reset to Defaults". */
  resetToDefaults: () => void;
  togglePrimaryPanel: () => void;
  toggleAiPanel: () => void;
};

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      density: 'comfortable',
      activeView: 'workspace',
      editMode: 'repair',
      workspaceMode: 'fix',
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
      primaryPanelVisible: true,
      aiPanelVisible: true,
      watchModeEnabled: false,
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
      setEditMode: (editMode) => {
        set({ editMode });
      },
      setWorkspaceMode: (workspaceMode) => {
        // Switching mode also moves to that mode's home view — Problems for Fix & Analyze, Files
        // for Code — because "Problems leads" / "the editor leads" is most of what the mode means,
        // and changing only the pane widths would leave the user staring at the same panel.
        //
        // Guarded so it only ever swaps between those two: someone in Search, Source Control or
        // Packages who flips the mode keeps the view they deliberately chose. Yanking them to a
        // different panel would be the switch overreaching.
        const { activeView } = get();
        const home: ActivityView = workspaceMode === 'code' ? 'workspace' : 'findings';
        const isOtherHome = activeView === (workspaceMode === 'code' ? 'findings' : 'workspace');
        set(isOtherHome ? { workspaceMode, activeView: home } : { workspaceMode });
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
      setWatchModeEnabled: (watchModeEnabled) => {
        set({ watchModeEnabled });
      },
      resetToDefaults: () => {
        set({
          theme: 'dark',
          density: 'comfortable',
          editorTheme: 'fixora',
          minimapEnabled: true,
          autoSave: false,
          formatOnSave: true,
          watchModeEnabled: false,
        });
      },
      togglePrimaryPanel: () => {
        set((s) => ({ primaryPanelVisible: !s.primaryPanelVisible }));
      },
      toggleAiPanel: () => {
        set((s) => ({ aiPanelVisible: !s.aiPanelVisible }));
      },
    }),
    {
      name: 'fixora.ui',
      // Only durable facts are persisted. paletteOpen and (later) transient selection are not.
      partialize: (s) => ({
        theme: s.theme,
        density: s.density,
        activeView: s.activeView,
        workspaceMode: s.workspaceMode,
        panelLayout: s.panelLayout,
        telemetryEnabled: s.telemetryEnabled,
        autoSave: s.autoSave,
        formatOnSave: s.formatOnSave,
        editorTheme: s.editorTheme,
        minimapEnabled: s.minimapEnabled,
        terminalFontSize: s.terminalFontSize,
        reopenLastProject: s.reopenLastProject,
        watchModeEnabled: s.watchModeEnabled,
        primaryPanelVisible: s.primaryPanelVisible,
        aiPanelVisible: s.aiPanelVisible,
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
          workspaceMode: oneOf(p.workspaceMode, WORKSPACE_MODES, current.workspaceMode),
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
          // Same fail-closed rule as autoSave/reopenLastProject: unsolicited analysis on every save
          // only happens if the persisted value is explicitly `true`.
          watchModeEnabled: p.watchModeEnabled === true,
          // Defaults to true (unlike the two above): only an explicit persisted `false` opts out,
          // so a missing/corrupt value falls back to the feature's own default rather than off.
          formatOnSave: p.formatOnSave !== false,
          editorTheme: oneOf(p.editorTheme, EDITOR_THEMES, current.editorTheme),
          minimapEnabled: p.minimapEnabled !== false,
          terminalFontSize:
            typeof p.terminalFontSize === 'number' && p.terminalFontSize >= 8 && p.terminalFontSize <= 32
              ? p.terminalFontSize
              : current.terminalFontSize,
          // Defaults to true, same as formatOnSave/minimapEnabled: only an explicit persisted
          // `false` hides a pane on the next launch.
          primaryPanelVisible: p.primaryPanelVisible !== false,
          aiPanelVisible: p.aiPanelVisible !== false,
        };
      },
    },
  ),
);
