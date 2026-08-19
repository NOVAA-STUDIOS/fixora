import { useEffect, useState } from 'react';

import { invoke, subscribe } from '../../lib/bridge.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useEditorStatusStore } from '../editor/editor-status-store.js';
import { useFindingsStore } from '../findings/findings-store.js';
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

  const line = useEditorStatusStore((s) => s.line);
  const column = useEditorStatusStore((s) => s.column);
  const language = useEditorStatusStore((s) => s.language);

  const analysis =
    status === 'running'
      ? 'Analyzing…'
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
        <span className="truncate" title={workspace?.rootPath ?? undefined}>
          {workspace === null ? 'No folder open' : workspace.name}
        </span>
        {workspace !== null && (
          <>
            <span aria-hidden="true" className="text-border-strong">
              ·
            </span>
            <span className="shrink-0">{analysis}</span>
            {watchModeEnabled && (
              <>
                <span aria-hidden="true" className="text-border-strong">
                  ·
                </span>
                <span
                  className="flex shrink-0 items-center gap-1"
                  title={
                    watchActivity === 'reanalyzing'
                      ? 'Watch Mode: re-analyzing the file you just saved.'
                      : 'Watch Mode: on. Files are re-analyzed automatically when saved.'
                  }
                >
                  <span
                    aria-hidden="true"
                    className={watchActivity !== 'idle' ? 'animate-pulse' : undefined}
                  >
                    👁
                  </span>
                  {watchActivity === 'reanalyzing' ? 'Re-analyzing…' : 'Watching'}
                </span>
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
          <span className="flex h-full shrink-0 items-center px-2.5">UTF-8</span>
        )}
        <StatusButton
          onClick={toggleDensity}
          title={`Density: ${density}. Click to switch.`}
          ariaLabel={`Density: ${density}. Switch density.`}
        >
          {density}
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
