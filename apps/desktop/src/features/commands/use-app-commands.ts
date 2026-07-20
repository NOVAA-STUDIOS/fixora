import { useMemo } from 'react';

import { useUiStore } from '../../stores/ui-store.js';
import { useFindingsStore } from '../findings/findings-store.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import type { Command } from './registry.js';

/**
 * The concrete commands the M1 shell exposes, derived from the UI store. As features land (M2+),
 * each contributes its own commands the same way; this is just the first set. Everything the shell
 * can *do* is here, which is what lets the palette, the keybindings and (later) the menu bar all
 * come from one place.
 */
export function useAppCommands(): Command[] {
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const toggleDensity = useUiStore((s) => s.toggleDensity);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const togglePalette = useUiStore((s) => s.togglePalette);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const pickAndOpen = useWorkspaceStore((s) => s.pickAndOpen);
  const runAnalysis = useFindingsStore((s) => s.run);

  return useMemo(
    () => [
      // The two actions a first-time user needs most, reachable by keyboard and by palette search.
      {
        id: 'workspace.open',
        title: 'Open folder…',
        group: 'Workspace',
        keybinding: 'mod+o',
        keywords: ['project', 'switch', 'repository', 'repo'],
        run: () => {
          setPaletteOpen(false);
          void pickAndOpen();
        },
      },
      {
        id: 'analysis.run',
        title: 'Run analysis',
        group: 'Workspace',
        keywords: ['analyze', 'scan', 'lint', 'problems', 'findings'],
        run: () => {
          setPaletteOpen(false);
          setActiveView('findings');
          void runAnalysis();
        },
      },
      {
        id: 'palette.open',
        title: 'Open command palette',
        group: 'General',
        keybinding: 'mod+k',
        run: () => {
          togglePalette();
        },
      },
      {
        id: 'view.toggleTheme',
        title: 'Toggle light / dark theme',
        group: 'View',
        keybinding: 'mod+shift+l',
        keywords: ['dark', 'light', 'appearance'],
        run: () => {
          toggleTheme();
        },
      },
      {
        id: 'view.toggleDensity',
        title: 'Toggle compact / comfortable density',
        group: 'View',
        keybinding: 'mod+shift+d',
        keywords: ['spacing', 'compact', 'comfortable'],
        run: () => {
          toggleDensity();
        },
      },
      {
        // Palette-only, and named so it reads as a tool rather than a feature. There is no rail
        // item for it: a debugging surface in the main navigation stops being a debugging surface.
        id: 'debug.workspaceDiagnostics',
        title: 'Debug: Workspace diagnostics',
        group: 'Go to',
        keywords: ['diagnostics', 'workspace', 'debug', 'attribution', 'isolation', 'cache'],
        run: () => {
          setActiveView('diagnostics');
          setPaletteOpen(false);
        },
      },
      {
        id: 'view.workspace',
        title: 'Go to Files',
        group: 'Go to',
        run: () => {
          setActiveView('workspace');
          setPaletteOpen(false);
        },
      },
      {
        id: 'view.findings',
        title: 'Go to Problems',
        group: 'Go to',
        run: () => {
          setActiveView('findings');
          setPaletteOpen(false);
        },
      },
      {
        id: 'view.history',
        title: 'Go to History',
        group: 'Go to',
        run: () => {
          setActiveView('history');
          setPaletteOpen(false);
        },
      },
      {
        id: 'view.settings',
        title: 'Go to Settings',
        group: 'Go to',
        keybinding: 'mod+,',
        run: () => {
          setActiveView('settings');
          setPaletteOpen(false);
        },
      },
    ],
    [
      toggleTheme,
      toggleDensity,
      setActiveView,
      togglePalette,
      setPaletteOpen,
      pickAndOpen,
      runAnalysis,
    ],
  );
}
