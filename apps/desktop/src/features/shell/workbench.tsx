import { PanelGroupRoot, ResizablePanel, ResizeHandle } from '@fixora/ui';
import { lazy, Suspense, useCallback, useRef } from 'react';

import { ErrorBoundary } from '../../app/error-boundary.js';
import { useUiStore, type PaneSizes } from '../../stores/ui-store.js';
import { AiPanel } from '../ai/ai-panel.js';
import { EditModeTabs, ProceedView } from '../ai/proceed-panel.js';
import { EditorArea } from '../editor/editor-area.js';
import { FindingsPanel } from '../findings/findings-panel.js';
import { HistoryPanel } from '../history/history-panel.js';
import { SettingsPanel } from '../settings/settings-panel.js';
import { ShieldPanel } from '../shield/shield-panel.js';
import { useShieldWatch } from '../shield/use-shield-watch.js';
import { SuggestionPanel } from '../suggestions/suggestion-panel.js';
import { WorkspacePanel } from '../workspace/workspace-panel.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { HomeScreen } from './home-screen.js';
import { PrimaryPlaceholder } from './placeholder-views.js';
import { WorkspaceDiagnostics } from './workspace-diagnostics.js';

// Code-split: each pulls in a chunk of weight (xterm+addons, npm/PyPI search clients, git diff
// rendering) that a session which never opens that view shouldn't pay for at startup.
const PackagesPanel = lazy(() =>
  import('../packages/packages-panel.js').then((m) => ({ default: m.PackagesPanel })),
);
const SearchPanel = lazy(() =>
  import('../search/search-panel.js').then((m) => ({ default: m.SearchPanel })),
);
const SourceControlPanel = lazy(() =>
  import('../source-control/source-control-panel.js').then((m) => ({
    default: m.SourceControlPanel,
  })),
);
const TerminalPanel = lazy(() =>
  import('../terminal/terminal-panel.js').then((m) => ({ default: m.TerminalPanel })),
);

function PanelFallback(): React.JSX.Element {
  return <div className="flex h-full items-center justify-center text-xs text-fg-muted">Loading…</div>;
}

/**
 * Default proportions, per view.
 *
 * One width could never serve every view, and pretending otherwise was the layout's real problem.
 * A file tree is a column of short names — VS Code gives it about 15–18% and it is *right*, because
 * every extra pixel there is a pixel stolen from code. A problems list is the opposite: each row
 * carries a message, a path, a rule id and a row of actions, and at the tree's width it truncated
 * all four. The old single 22% was the average of those two needs and served neither.
 *
 * So the split follows the view. The editor keeps the majority in every case — it is what the user
 * came to look at — and the assistant is sized to hold a diff without dominating.
 */
const DEFAULT_LAYOUT: Record<string, Record<string, number>> = {
  // Files: a narrow explorer, VS Code proportions, and the widest possible editor.
  workspace: { primary: 17, editor: 59, ai: 24 },
  // Problems: the list is the thing being worked, so it earns real width.
  findings: { primary: 28, editor: 46, ai: 26 },
  // History rows carry a verdict, a rationale and a file — wider than a tree, narrower than problems.
  history: { primary: 25, editor: 50, ai: 25 },
  // Search results carry a filename, a line and up to three lines of context — closer to problems'
  // width need than the tree's.
  search: { primary: 28, editor: 46, ai: 26 },
  packages: { primary: 26, editor: 48, ai: 26 },
  sourceControl: { primary: 28, editor: 46, ai: 26 },
};

/**
 * Code mode's proportions: the editor leads everywhere.
 *
 * One shape for every view rather than a second per-view table, because that is exactly what the
 * mode means — "I am writing code right now, give the editor the room" — and a per-view spread
 * would just re-introduce the tuning the mode exists to override. The side panel keeps a real,
 * readable width (a file tree is the thing you navigate from) and the assistant keeps enough to
 * hold a diff, so nothing is hidden or unusable; it is a re-weighting, not a different app.
 */
const CODE_MODE_LAYOUT: PaneSizes = { primary: 16, editor: 66, ai: 18 };

function PrimaryPanel({ view }: { view: string }): React.JSX.Element {
  if (view === 'workspace') return <WorkspacePanel />;
  if (view === 'findings') return <FindingsPanel />;
  if (view === 'history') return <HistoryPanel />;
  if (view === 'search')
    return (
      <Suspense fallback={<PanelFallback />}>
        <SearchPanel />
      </Suspense>
    );
  if (view === 'packages')
    return (
      <Suspense fallback={<PanelFallback />}>
        <PackagesPanel />
      </Suspense>
    );
  if (view === 'sourceControl')
    return (
      <Suspense fallback={<PanelFallback />}>
        <SourceControlPanel />
      </Suspense>
    );
  return <PrimaryPlaceholder />;
}

/**
 * The three-pane workbench (Design Review §5): the resizable panels between the activity rail and
 * the AI panel. The layout is persisted through the store, so pane sizes survive a restart — the
 * library owns the live layout, the store owns the saved copy, and there is exactly one of each
 * (ADR-015). The centre is the editor; the AI panel arrives in M5.
 *
 * Terminal is a permanent sibling here, not a branch of `WorkbenchContent`'s per-view switch:
 * mounted once and shown/hidden with a CSS class, never unmounted by switching to another activity
 * view. Unmounting it would tear down every `TerminalInstance` and kill every shell — the opposite
 * of Ctrl+`'s promise ("background shells keep running" while you look at something else).
 */
export function Workbench(): React.JSX.Element {
  const activeView = useUiStore((s) => s.activeView);
  // Code Shield auto-analyzes the active file. Driven from here, not from a view, so switching
  // panels never tears down the watcher and loses the report the status bar is showing.
  useShieldWatch();
  // Deferred until the user first opens Terminal — not up front on app boot — but once mounted it
  // stays mounted forever (see the comment below): the CSS-hidden trick that keeps background
  // shells alive only works if this flag never goes back to false.
  const everActivatedTerminal = useRef(false);
  if (activeView === 'terminal') everActivatedTerminal.current = true;
  return (
    <>
      {everActivatedTerminal.current && (
        <div className={activeView === 'terminal' ? 'flex min-h-0 flex-1' : 'hidden'}>
          <ErrorBoundary label="Terminal">
            <Suspense fallback={<PanelFallback />}>
              <TerminalPanel />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}
      {activeView !== 'terminal' && <WorkbenchContent />}
      <ShieldPanel />
    </>
  );
}

function WorkbenchContent(): React.JSX.Element {
  const savedLayout = useUiStore((s) => s.panelLayout);
  const setPanelLayout = useUiStore((s) => s.setPanelLayout);
  const activeView = useUiStore((s) => s.activeView);
  const workspaceMode = useUiStore((s) => s.workspaceMode);
  const hasWorkspace = useWorkspaceStore((s) => s.workspace !== null);

  // Saved sizes are keyed by MODE and view together. Keying by view alone would make the two modes
  // fight over one stored number: drag the editor wide in Code mode and Fix mode would reopen with
  // the same drag applied, which is precisely the tuning the mode was chosen to get away from.
  const layoutKey = `${workspaceMode}:${activeView}`;
  const defaultLayout =
    workspaceMode === 'code' ? CODE_MODE_LAYOUT : DEFAULT_LAYOUT[activeView];

  const onLayoutChanged = useCallback(
    (layout: Record<string, number>) => {
      setPanelLayout(layoutKey, layout);
    },
    [setPanelLayout, layoutKey],
  );

  // With no project open there is nothing for three panes to show, and each used to render its own
  // "nothing here" state — three empty columns as the product's first impression. One Home surface
  // replaces all of it, and the panes come back the moment there is a project to put in them.
  if (
    !hasWorkspace &&
    activeView !== 'settings' &&
    activeView !== 'diagnostics' &&
    activeView !== 'suggestions'
  ) {
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
  // Full-width, like settings: it is a debugging document, not a side panel.
  if (activeView === 'diagnostics') {
    return (
      <ErrorBoundary label="Workspace diagnostics">
        <WorkspaceDiagnostics />
      </ErrorBoundary>
    );
  }

  if (activeView === 'settings') {
    return (
      <ErrorBoundary label="Settings">
        <SettingsPanel />
      </ErrorBoundary>
    );
  }

  // Suggestions is feedback about Fixora itself, not about the open project — full width like
  // Settings, and reachable whether or not a workspace is open.
  if (activeView === 'suggestions') {
    return (
      <ErrorBoundary label="Suggestions">
        <SuggestionPanel />
      </ErrorBoundary>
    );
  }

  return (
    <PanelGroupRoot
      // Keyed by mode+view so the group remounts and picks up that combination's proportions.
      key={layoutKey}
      orientation="horizontal"
      defaultLayout={savedLayout[layoutKey] ?? defaultLayout}
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
      <ResizablePanel id="primary" minSize={200} defaultSize="20" className="min-w-0">
        {/* Per-pane, so a malformed finding or an unreadable file costs the user one panel rather
            than the whole window. The root boundary in main.tsx is the backstop behind these. */}
        <ErrorBoundary label="The side panel">
          <PrimaryPanel view={activeView} />
        </ErrorBoundary>
      </ResizablePanel>
      <ResizeHandle aria-label="Resize primary panel" />
      <ResizablePanel id="editor" minSize={340} defaultSize="56" className="min-w-0">
        <ErrorBoundary label="The editor">
          <EditorArea />
        </ErrorBoundary>
      </ResizablePanel>
      <ResizeHandle aria-label="Resize AI panel" />
      <ResizablePanel id="ai" minSize={260} defaultSize="24" className="min-w-0">
        <ErrorBoundary label="The assistant panel">
          <AssistantPanel />
        </ErrorBoundary>
      </ResizablePanel>
    </PanelGroupRoot>
  );
}

/**
 * The assistant pane: Repair (unchanged) beside Proceed. A mode switch, not a redesign — Repair
 * renders exactly the panel it always did, and Explain stays the disabled placeholder it is.
 */
function AssistantPanel(): React.JSX.Element {
  // From the store, not local state: the Problems panel's Explain button switches to this tab.
  const mode = useUiStore((s) => s.editMode);
  const setMode = useUiStore((s) => s.setEditMode);
  // A flex column that owns the pane's height. The first version returned a bare Fragment, so the tab
  // strip and the `h-full` AiPanel were siblings with no height distribution — together they exceeded
  // the pane, squeezing the strip and overflowing the panel. `min-h-0` lets the body actually shrink.
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <EditModeTabs active={mode} onChange={setMode} />
      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === 'proceed' ? <ProceedView /> : <AiPanel />}
      </div>
    </div>
  );
}
