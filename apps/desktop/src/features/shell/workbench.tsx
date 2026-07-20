import { PanelGroupRoot, ResizablePanel, ResizeHandle } from '@fixora/ui';
import { useCallback } from 'react';

import { ErrorBoundary } from '../../app/error-boundary.js';
import { useUiStore } from '../../stores/ui-store.js';
import { AiPanel } from '../ai/ai-panel.js';
import { EditorArea } from '../editor/editor-area.js';
import { FindingsPanel } from '../findings/findings-panel.js';
import { HistoryPanel } from '../history/history-panel.js';
import { SettingsPanel } from '../settings/settings-panel.js';
import { WorkspacePanel } from '../workspace/workspace-panel.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { HomeScreen } from './home-screen.js';
import { PrimaryPlaceholder } from './placeholder-views.js';

function PrimaryPanel({ view }: { view: string }): React.JSX.Element {
  if (view === 'workspace') return <WorkspacePanel />;
  if (view === 'findings') return <FindingsPanel />;
  if (view === 'history') return <HistoryPanel />;
  return <PrimaryPlaceholder />;
}

/**
 * The three-pane workbench (Design Review §5): the resizable panels between the activity rail and
 * the AI panel. The layout is persisted through the store, so pane sizes survive a restart — the
 * library owns the live layout, the store owns the saved copy, and there is exactly one of each
 * (ADR-015). The centre is the editor; the AI panel arrives in M5.
 */
export function Workbench(): React.JSX.Element {
  const savedLayout = useUiStore((s) => s.panelLayout);
  const setPanelLayout = useUiStore((s) => s.setPanelLayout);
  const activeView = useUiStore((s) => s.activeView);
  const hasWorkspace = useWorkspaceStore((s) => s.workspace !== null);

  const onLayoutChanged = useCallback(
    (layout: Record<string, number>) => {
      setPanelLayout(layout);
    },
    [setPanelLayout],
  );

  // With no project open there is nothing for three panes to show, and each used to render its own
  // "nothing here" state — three empty columns as the product's first impression. One Home surface
  // replaces all of it, and the panes come back the moment there is a project to put in them.
  if (!hasWorkspace && activeView !== 'settings') {
    return (
      <ErrorBoundary label="The home screen">
        <HomeScreen />
      </ErrorBoundary>
    );
  }

  // Settings is a form, not a tree: label-above-control fields, paragraphs of explanatory copy, and
  // a keybinding table. In the 220px primary pane every one of those wrapped to a ribbon — the auto
  // save description alone ran to ten lines. It gets the full workbench and a reading-width column,
  // which is what VS Code, Linear and Raycast all do with settings for the same reason.
  if (activeView === 'settings') {
    return (
      <ErrorBoundary label="Settings">
        <SettingsPanel />
      </ErrorBoundary>
    );
  }

  return (
    <PanelGroupRoot
      orientation="horizontal"
      defaultLayout={Object.keys(savedLayout).length > 0 ? savedLayout : undefined}
      onLayoutChanged={onLayoutChanged}
      className="min-h-0 flex-1"
    >
      {/*
        react-resizable-panels v4: a NUMBER is pixels, a unit-less STRING is a percentage. So the
        defaults below are proportions, and the minimums are hard pixel floors — a pane must never
        shrink to the point its content becomes unreadable (a settings label per line, a clipped
        select). The floors sum to 780px + the 64px rail, which still fits the window's 940px
        minWidth, so the layout can never become over-constrained.
      */}
      <ResizablePanel id="primary" minSize={220} defaultSize="22" className="min-w-0">
        {/* Per-pane, so a malformed finding or an unreadable file costs the user one panel rather
            than the whole window. The root boundary in main.tsx is the backstop behind these. */}
        <ErrorBoundary label="The side panel">
          <PrimaryPanel view={activeView} />
        </ErrorBoundary>
      </ResizablePanel>
      <ResizeHandle aria-label="Resize primary panel" />
      <ResizablePanel id="editor" minSize={320} defaultSize="52" className="min-w-0">
        <ErrorBoundary label="The editor">
          <EditorArea />
        </ErrorBoundary>
      </ResizablePanel>
      <ResizeHandle aria-label="Resize AI panel" />
      <ResizablePanel id="ai" minSize={240} defaultSize="26" className="min-w-0">
        <ErrorBoundary label="The assistant panel">
          <AiPanel />
        </ErrorBoundary>
      </ResizablePanel>
    </PanelGroupRoot>
  );
}
