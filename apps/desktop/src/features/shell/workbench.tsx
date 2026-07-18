import { PanelGroupRoot, ResizablePanel, ResizeHandle } from '@fixora/ui';
import { useCallback } from 'react';

import { useUiStore } from '../../stores/ui-store.js';
import { AiPanel } from '../ai/ai-panel.js';
import { EditorArea } from '../editor/editor-area.js';
import { FindingsPanel } from '../findings/findings-panel.js';
import { HistoryPanel } from '../history/history-panel.js';
import { SettingsPanel } from '../settings/settings-panel.js';
import { WorkspacePanel } from '../workspace/workspace-panel.js';

import { PrimaryPlaceholder } from './placeholder-views.js';

function PrimaryPanel({ view }: { view: string }): React.JSX.Element {
  if (view === 'workspace') return <WorkspacePanel />;
  if (view === 'findings') return <FindingsPanel />;
  if (view === 'history') return <HistoryPanel />;
  if (view === 'settings') return <SettingsPanel />;
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

  const onLayoutChanged = useCallback(
    (layout: Record<string, number>) => {
      setPanelLayout(layout);
    },
    [setPanelLayout],
  );

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
        <PrimaryPanel view={activeView} />
      </ResizablePanel>
      <ResizeHandle aria-label="Resize primary panel" />
      <ResizablePanel id="editor" minSize={320} defaultSize="52" className="min-w-0">
        <EditorArea />
      </ResizablePanel>
      <ResizeHandle aria-label="Resize AI panel" />
      <ResizablePanel id="ai" minSize={240} defaultSize="26" className="min-w-0">
        <AiPanel />
      </ResizablePanel>
    </PanelGroupRoot>
  );
}
