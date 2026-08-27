import { useMemo } from 'react';

import { useTestGenerationStore } from '../../stores/test-generation-store.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useEditorStore } from '../editor/editor-store.js';
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
  const toggleTerminal = useUiStore((s) => s.toggleTerminal);
  const toggleDensity = useUiStore((s) => s.toggleDensity);
  const togglePrimaryPanel = useUiStore((s) => s.togglePrimaryPanel);
  const toggleAiPanel = useUiStore((s) => s.toggleAiPanel);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const togglePalette = useUiStore((s) => s.togglePalette);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const pickAndOpen = useWorkspaceStore((s) => s.pickAndOpen);
  const runAnalysis = useFindingsStore((s) => s.run);
  const tabs = useEditorStore((s) => s.tabs);
  const activeTab = useEditorStore((s) => s.activeTab);
  const splitRelPath = useEditorStore((s) => s.splitRelPath);
  const setSplit = useEditorStore((s) => s.setSplit);
  const generateTests = useTestGenerationStore((s) => s.generate);
  const generatingFor = useTestGenerationStore((s) => s.generatingFor);

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
        // VS Code's own command-palette shortcut, offered alongside this app's existing mod+k.
        altKeybinding: 'mod+shift+p',
        run: () => {
          togglePalette();
        },
      },
      {
        id: 'terminal.toggle',
        title: 'Toggle terminal',
        group: 'View',
        keybinding: 'mod+`',
        keywords: ['shell', 'console'],
        run: () => {
          toggleTerminal();
        },
      },
      {
        id: 'editor.toggleSplit',
        title: splitRelPath === null ? 'Split editor right' : 'Close split editor',
        group: 'View',
        keybinding: 'mod+\\',
        keywords: ['split', 'side by side'],
        enabled: () => tabs.length > 0,
        run: () => {
          if (splitRelPath !== null) {
            setSplit(null);
            return;
          }
          // The next tab after the active one, wrapping — if there is only one tab open, split
          // shows it against itself (the same file, two cursors/scroll positions), which is a real
          // and useful case (comparing two parts of one long file), not a degenerate one.
          const index = tabs.findIndex((t) => t.relPath === activeTab);
          const other = tabs[(index + 1) % tabs.length] ?? tabs[0];
          if (other !== undefined) setSplit(other.relPath);
        },
      },
      {
        id: 'ai.generateTests',
        title: generatingFor !== null ? 'Generating tests…' : 'Generate Tests',
        group: 'AI',
        keywords: ['unit', 'test', 'vitest', 'jest', 'pytest'],
        enabled: () => activeTab !== null && generatingFor === null,
        run: () => {
          if (activeTab === null) return;
          setPaletteOpen(false);
          void generateTests(activeTab);
        },
      },
      {
        id: 'view.togglePrimaryPanel',
        title: 'Toggle primary panel',
        group: 'View',
        keybinding: 'mod+b',
        keywords: ['sidebar', 'left', 'hide', 'show'],
        run: () => {
          togglePrimaryPanel();
        },
      },
      {
        id: 'view.toggleAiPanel',
        title: 'Toggle AI panel',
        group: 'View',
        keybinding: 'mod+j',
        keywords: ['assistant', 'right', 'hide', 'show'],
        run: () => {
          toggleAiPanel();
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
      toggleTerminal,
      toggleDensity,
      togglePrimaryPanel,
      toggleAiPanel,
      setActiveView,
      togglePalette,
      setPaletteOpen,
      pickAndOpen,
      runAnalysis,
      tabs,
      activeTab,
      splitRelPath,
      setSplit,
      generateTests,
      generatingFor,
    ],
  );
}
