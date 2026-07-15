import { PanelGroupRoot, ResizablePanel, ResizeHandle } from '@fixora/ui';
import { useCallback } from 'react';

import { useUiStore } from '../../stores/ui-store.js';
import { EditorArea } from '../editor/editor-area.js';
import { SettingsPanel } from '../settings/settings-panel.js';
import { WorkspacePanel } from '../workspace/workspace-panel.js';

import { PrimaryPlaceholder } from './placeholder-views.js';

function PrimaryPanel({ view }: { view: string }): React.JSX.Element {
  if (view === 'workspace') return <WorkspacePanel />;
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
      <ResizablePanel id="primary" minSize={16} defaultSize={22} className="min-w-0">
        <PrimaryPanel view={activeView} />
      </ResizablePanel>
      <ResizeHandle aria-label="Resize primary panel" />
      <ResizablePanel id="editor" minSize={30} defaultSize={52} className="min-w-0">
        <EditorArea />
      </ResizablePanel>
      <ResizeHandle aria-label="Resize AI panel" />
      <ResizablePanel id="ai" minSize={16} defaultSize={26} className="min-w-0">
        <AiPlaceholder />
      </ResizablePanel>
    </PanelGroupRoot>
  );
}

function AiPlaceholder(): React.JSX.Element {
  return (
    <section
      aria-label="Assistant"
      className="flex h-full items-center justify-center border-l border-border-subtle bg-canvas text-sm text-fg-muted"
    >
      AI panel — M5
    </section>
  );
}
