import { Button, Dialog, DialogContent, DialogTitle, cn } from '@fixora/ui';
import { useEffect, useState } from 'react';

import { invoke, subscribe } from '../../lib/bridge.js';
import { copyToClipboard } from '../../lib/clipboard.js';
import { useMcpStore } from '../../stores/mcp-store.js';
import { useStatsStore } from '../../stores/stats-store.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useUpdateStore } from '../../stores/update-store.js';
import { useEditorStatusStore } from '../editor/editor-status-store.js';
import { useFindingsStore } from '../findings/findings-store.js';
import { scoreTone } from '../shield/shield-panel.js';
import { useShieldStore } from '../shield/shield-store.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

/**
 * The status bar (Design Review §5) — the thin strip along the bottom. It answers "what am I looking
 * at?" without the user hunting: the open project, the analysis status, and the finding counts. It is
 * a `role="status"` region so analysis progress is announced to assistive tech.
 */
export function StatusBar(): React.JSX.Element {
  const density = useUiStore((s) => s.density);
  const theme = useUiStore((s) => s.theme);
  const toggleDensity = useUiStore((s) => s.toggleDensity);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const primaryPanelVisible = useUiStore((s) => s.primaryPanelVisible);
  const aiPanelVisible = useUiStore((s) => s.aiPanelVisible);
  const togglePrimaryPanel = useUiStore((s) => s.togglePrimaryPanel);
  const toggleAiPanel = useUiStore((s) => s.toggleAiPanel);
  const wordWrap = useUiStore((s) => s.wordWrap);
  const setWordWrap = useUiStore((s) => s.setWordWrap);
  const tabSize = useUiStore((s) => s.tabSize);
  const setTabSize = useUiStore((s) => s.setTabSize);
  const cycleTabSize = (): void => {
    setTabSize(tabSize === 2 ? 4 : tabSize === 4 ? 8 : 2);
  };

  const workspace = useWorkspaceStore((s) => s.workspace);
  const [branch, setBranch] = useState<string | null>(null);
  useEffect(() => {
    if (workspace === null) {
      setBranch(null);
      return;
    }
    void invoke('git:status', {}).then((result) => {
      setBranch(result.ok ? result.value.branch : null);
    });
  }, [workspace]);
  const summary = useFindingsStore((s) => s.summary);
  const status = useFindingsStore((s) => s.status);
  const totalFiles = useFindingsStore((s) => s.totalFiles);
  const setActiveView = useUiStore((s) => s.setActiveView);

  const watchModeEnabled = useUiStore((s) => s.watchModeEnabled);
  // 'idle': watching, nothing happening right now. 'pulsing': a change was just detected (a brief
  // flash, cleared on a timer — chokidar's `change` event carries no "I'm done reacting" signal of
  // its own). 'reanalyzing': the single-file re-analysis this change triggered is in flight.
  const [watchActivity, setWatchActivity] = useState<'idle' | 'pulsing' | 'reanalyzing'>('idle');

  useEffect(() => {
    if (!watchModeEnabled || workspace === null) {
      void invoke('analysis:watchStop', {});
      return;
    }
    void invoke('analysis:watchStart', {});
    return () => {
      void invoke('analysis:watchStop', {});
    };
    // Re-runs on a workspace switch too — the watcher is scoped to whichever root was current when
    // `watchStart` was called, so a new workspace needs its own call, not a reuse of the old one.
  }, [watchModeEnabled, workspace]);

  useEffect(() => {
    return subscribe('analysis:watchEvent', ({ status: eventStatus }) => {
      if (eventStatus === 'reanalyzing') {
        setWatchActivity('reanalyzing');
      } else if (eventStatus === 'done') {
        setWatchActivity('idle');
      } else {
        // 'changed': flash briefly, then settle back — 'reanalyzing' (sent right after, in
        // analysis.handlers.ts) will normally supersede this before the timer even fires.
        setWatchActivity('pulsing');
        setTimeout(() => {
          setWatchActivity((current) => (current === 'pulsing' ? 'idle' : current));
        }, 600);
      }
    });
  }, []);

  // Background file-index progress (workspace-service.ts's indexFiles). No "done" event exists —
  // a single-pass walk doesn't know it has finished until it has, at which point there is nothing
  // left to announce — so this hides itself after a short idle gap since the last progress push
  // instead, treating silence as completion.
  const [indexed, setIndexed] = useState<number | null>(null);
  useEffect(() => {
    setIndexed(null);
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribe('workspace:indexProgress', ({ indexed: count }) => {
      setIndexed(count);
      if (hideTimer !== null) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        setIndexed(null);
      }, 2000);
    });
    return () => {
      unsubscribe();
      if (hideTimer !== null) clearTimeout(hideTimer);
    };
  }, [workspace]);

  const line = useEditorStatusStore((s) => s.line);
  const column = useEditorStatusStore((s) => s.column);
  const language = useEditorStatusStore((s) => s.language);
  const encoding = useEditorStatusStore((s) => s.encoding);

  const mcpRunning = useMcpStore((s) => s.running);
  const loadMcp = useMcpStore((s) => s.load);
  useEffect(() => {
    void loadMcp();
  }, [loadMcp]);

  const stats = useStatsStore((s) => s.stats);
  const refreshStats = useStatsStore((s) => s.refresh);
  useEffect(() => {
    void refreshStats();
  }, [refreshStats, workspace]);

  const analysis =
    status === 'running'
      ? totalFiles !== null
        ? `Analyzing… (${String(totalFiles)} files)`
        : 'Analyzing…'
      : summary === null
        ? 'Not analyzed yet'
        : summary.total === 0
          ? 'No problems'
          : `${String(summary.total)} problem${summary.total === 1 ? '' : 's'}`;

  return (
    <footer
      role="status"
      // Height follows density: at compact every row of vertical space is contested, and a status bar
      // is the cheapest place to give one back. Token-driven so it cannot drift from the toggle.
      className="flex h-(--fx-status-bar-height) shrink-0 items-center justify-between gap-3 px-3 text-xs text-fg-muted select-none"
    >
      <div className="flex min-w-0 items-center gap-2">
        <ShieldPill />
        <UpdateReadyPill />
        <span aria-hidden="true" className="text-border-strong">
          ·
        </span>
        {stats !== null && stats.repairedToday > 0 && (
          <>
            <span title={`${String(stats.repairedTotal)} total repairs all time`}>
              ⚡ {stats.repairedToday} fixed today
            </span>
            <span aria-hidden="true" className="text-border-strong">
              ·
            </span>
          </>
        )}
        {/* An external process can trigger repairs that write to this project while MCP is
            serving. That must never be invisible — if it is running, the user can see it. */}
        {mcpRunning && (
          <>
            <span
              className="flex shrink-0 items-center gap-1.5 text-warn"
              title="An external MCP client can analyze and repair this project. Turn it off in Settings → MCP Server."
            >
              <span aria-hidden="true" className="size-1.5 rounded-full bg-warn" />
              MCP Active
            </span>
            <span aria-hidden="true" className="text-border-strong">
              ·
            </span>
          </>
        )}
        <span className="truncate" title={workspace?.rootPath ?? undefined}>
          {workspace === null ? 'No folder open' : workspace.name}
        </span>
        {workspace !== null && summary !== null && (
          <>
            <span aria-hidden="true" className="text-border-strong">
              ·
            </span>
            <button
              type="button"
              onClick={() => {
                setActiveView('findings');
              }}
              title="Open Problems"
              className="flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 tabular-nums transition-colors duration-(--fx-motion-duration-fast) hover:bg-hover"
            >
              🔴 {summary.bySeverity.error} ⚠️ {summary.bySeverity.warning}
            </button>
          </>
        )}
        {workspace !== null && (
          <>
            <span aria-hidden="true" className="text-border-strong">
              ·
            </span>
            <span className="shrink-0">{analysis}</span>
            {indexed !== null && (
              <>
                <span aria-hidden="true" className="text-border-strong">
                  ·
                </span>
                <span className="shrink-0">Indexing… {indexed.toLocaleString()} files</span>
              </>
            )}
            {watchModeEnabled && (
              <>
                <span aria-hidden="true" className="text-border-strong">
                  ·
                </span>
                <button
                  type="button"
                  onClick={() => {
                    useUiStore.getState().setWatchModeEnabled(false);
                  }}
                  title={
                    watchActivity === 'reanalyzing'
                      ? 'Watch Mode: re-analyzing the file you just saved.'
                      : 'Watch mode active — files re-analyze on save. Click to disable.'
                  }
                  aria-label="Watch mode active. Click to disable."
                  className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-success-text transition-colors duration-(--fx-motion-duration-fast) hover:bg-hover"
                >
                  <span
                    aria-hidden="true"
                    className={watchActivity !== 'idle' ? 'animate-pulse' : 'animate-pulse opacity-70'}
                  >
                    👁
                  </span>
                  {watchActivity === 'reanalyzing' ? 'Re-analyzing…' : 'Watching'}
                </button>
              </>
            )}
            {branch !== null && (
              <>
                <span aria-hidden="true" className="text-border-strong">
                  ·
                </span>
                <span className="shrink-0 truncate">{branch}</span>
              </>
            )}
          </>
        )}
      </div>
      {/*
        These read as two words of status text, not as controls — nothing about "comfortable dark"
        in the corner suggests it is clickable, so the density and theme toggles were effectively
        undiscoverable. Capitalised, given a hover surface that fills the bar's height (the VS Code
        status-bar-item pattern), and titled with what clicking does.
      */}
      <div className="flex h-full shrink-0 items-center">
        {line !== null && column !== null && (
          <span className="flex h-full shrink-0 items-center px-2.5">
            Ln {line}, Col {column}
          </span>
        )}
        {language !== null && (
          <span className="flex h-full shrink-0 items-center px-2.5 capitalize">{language}</span>
        )}
        {line !== null && (
          <button
            type="button"
            onClick={() => {
              void copyToClipboard(encoding ?? 'UTF-8', { label: 'Encoding copied' });
            }}
            title="Click to copy encoding"
            className="flex h-full shrink-0 items-center px-2.5 transition-colors duration-(--fx-motion-duration-fast) hover:bg-hover"
          >
            {encoding ?? 'UTF-8'}
          </button>
        )}
        <StatusButton
          onClick={togglePrimaryPanel}
          title={`${primaryPanelVisible ? 'Hide' : 'Show'} primary panel (Ctrl+B)`}
          ariaLabel={`${primaryPanelVisible ? 'Hide' : 'Show'} primary panel`}
        >
          ⬛ Panel
        </StatusButton>
        <StatusButton
          onClick={toggleAiPanel}
          title={`${aiPanelVisible ? 'Hide' : 'Show'} AI panel (Ctrl+J)`}
          ariaLabel={`${aiPanelVisible ? 'Hide' : 'Show'} AI panel`}
        >
          ⬛ AI
        </StatusButton>
        <StatusButton
          onClick={toggleDensity}
          title={`Density: ${density}. Click to switch.`}
          ariaLabel={`Density: ${density}. Switch density.`}
        >
          {density}
        </StatusButton>
        <StatusButton
          onClick={() => {
            setWordWrap(!wordWrap);
          }}
          title={`Word wrap: ${wordWrap ? 'on' : 'off'}. Click to switch.`}
          ariaLabel={`Word wrap: ${wordWrap ? 'on' : 'off'}. Toggle word wrap.`}
        >
          ↵
        </StatusButton>
        <StatusButton
          onClick={cycleTabSize}
          title={`Tab size: ${String(tabSize)}. Click to cycle.`}
          ariaLabel={`Tab size: ${String(tabSize)}. Cycle tab size.`}
        >
          Spaces: {tabSize}
        </StatusButton>
        <StatusButton
          onClick={toggleTheme}
          title={`Theme: ${theme}. Click to switch.`}
          ariaLabel={`Theme: ${theme}. Switch theme.`}
        >
          {theme}
        </StatusButton>
      </div>
    </footer>
  );
}

/**
 * Code Shield's score, at a glance. Deliberately shows `--` rather than a number whenever there is
 * no measured report — no file open, or a run that failed. A stale or invented score in the corner
 * of the window would be read as current, which is precisely the trust this feature trades on.
 */
function ShieldPill(): React.JSX.Element {
  const report = useShieldStore((s) => s.currentReport);
  const isAnalyzing = useShieldStore((s) => s.isAnalyzing);
  const setPanelOpen = useShieldStore((s) => s.setPanelOpen);
  const panelOpen = useShieldStore((s) => s.panelOpen);

  const measuredScore =
    report !== null && report.error === null && report.score !== null ? report.score : null;
  const label = isAnalyzing ? '...' : measuredScore !== null ? String(measuredScore) : '--';
  const tone = measuredScore !== null && !isAnalyzing ? scoreTone(measuredScore) : null;

  return (
    <button
      type="button"
      onClick={() => {
        setPanelOpen(!panelOpen);
      }}
      title={
        measuredScore !== null
          ? `Code Shield: ${String(measuredScore)}/100 — click for the full report`
          : 'Code Shield — open a file to see its score'
      }
      aria-label={`Code Shield score ${label}`}
      className={cn(
        'shrink-0 rounded px-1.5 py-0.5 tabular-nums transition-colors duration-(--fx-motion-duration-fast) hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline',
        tone === 'good' && 'text-success-text',
        tone === 'warn' && 'text-warn-text',
        tone === 'bad' && 'text-danger-text',
      )}
    >
      🛡️ {label}
    </button>
  );
}

/**
 * The update-ready pill. Renders nothing until a download has actually finished (`downloaded`) —
 * never on first launch, never while only "available"/downloading, since `update:install` is only
 * safe to send once main has something to install. Clicking opens the confirmation modal rather
 * than restarting immediately, so a user mid-repair is never surprised by the app quitting under
 * them.
 */
function UpdateReadyPill(): React.JSX.Element | null {
  const update = useUpdateStore((s) => s.update);
  const listen = useUpdateStore((s) => s.listen);
  const [open, setOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => listen(), [listen]);

  if (update.status !== 'downloaded') return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        title={`Update v${update.version} ready — click to restart`}
        aria-label={`Update v${update.version} ready. Click to restart.`}
        className="shrink-0 rounded px-1.5 py-0.5 text-accent-text transition-colors duration-(--fx-motion-duration-fast) hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
      >
        🔄 v{update.version} ready
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle className="text-base font-semibold text-fg">Update ready</DialogTitle>
          <p className="py-2 text-sm text-fg-secondary">
            Version {update.version} has downloaded and is ready to install.
          </p>
          <Button
            variant="primary"
            disabled={restarting}
            onClick={() => {
              setRestarting(true);
              void invoke('update:install', {});
            }}
          >
            {restarting ? 'Restarting…' : 'Restart Now'}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * A status-bar control. Full-height hover target with no rounding, so it reads as part of the bar
 * rather than as a pill floating in it — the same affordance VS Code gives its status items.
 */
function StatusButton({
  onClick,
  title,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  title: string;
  ariaLabel: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className="flex h-full items-center px-2.5 text-xs capitalize text-fg-muted transition-colors duration-(--fx-motion-duration-fast) ease-(--ease-entrance) hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline"
    >
      {children}
    </button>
  );
}
