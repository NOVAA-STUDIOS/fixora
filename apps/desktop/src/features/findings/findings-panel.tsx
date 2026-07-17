import type { Finding, Severity, TaskProfile } from '@fixora/shared-types';
import { AlertIcon, Button, VirtualList, cn } from '@fixora/ui';
import { useEffect } from 'react';

import { basename } from '../../lib/path.js';
import { useAiStore } from '../../stores/ai-store.js';
import { AiPanel } from '../ai/ai-panel.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { useFindingsStore } from './findings-store.js';

/**
 * The findings panel (roadmap M3): the evidence layer made visible. Virtualised (a large repo can
 * produce thousands of findings), grouped by severity through the DB's ordering, and filterable by
 * severity. Clicking a finding opens its file — the grounding a fix will later act on. Zero AI here;
 * this is the moat with the LLM switched off.
 */

const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'info'];
const SEVERITY_STYLE: Record<Severity, string> = {
  error: 'text-danger-text',
  warning: 'text-fg-secondary',
  info: 'text-fg-muted',
};

export function FindingsPanel(): React.JSX.Element {
  const findings = useFindingsStore((s) => s.findings);
  const summary = useFindingsStore((s) => s.summary);
  const status = useFindingsStore((s) => s.status);
  const filter = useFindingsStore((s) => s.filter);
  const refresh = useFindingsStore((s) => s.refresh);
  const run = useFindingsStore((s) => s.run);
  const cancel = useFindingsStore((s) => s.cancel);
  const setFilter = useFindingsStore((s) => s.setFilter);
  const listen = useFindingsStore((s) => s.listen);

  const workspace = useWorkspaceStore((s) => s.workspace);
  const loadAiConfig = useAiStore((s) => s.loadConfig);
  const listenAi = useAiStore((s) => s.listen);

  useEffect(() => listen(), [listen]);
  useEffect(() => listenAi(), [listenAi]);
  useEffect(() => {
    void loadAiConfig();
  }, [loadAiConfig]);
  useEffect(() => {
    if (workspace !== null) void refresh();
  }, [workspace, refresh]);

  return (
    <section
      aria-label="Problems"
      className="flex h-full flex-col border-r border-border-subtle bg-canvas"
    >
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-border-subtle px-3">
        <span className="text-xs font-semibold text-fg">Problems</span>
        {status === 'running' ? (
          <Button variant="ghost" size="sm" onClick={() => void cancel()}>
            Cancel
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void run()}
            disabled={workspace === null}
          >
            Run analysis
          </Button>
        )}
      </header>

      <div className="flex shrink-0 items-center gap-1 border-b border-border-subtle px-2 py-1.5">
        <SeverityFilter
          label="All"
          active={filter.severity === undefined}
          count={summary?.total}
          onClick={() => void setFilter({})}
        />
        {SEVERITY_ORDER.map((sev) => (
          <SeverityFilter
            key={sev}
            label={sev}
            active={filter.severity === sev}
            count={summary?.bySeverity[sev]}
            className={SEVERITY_STYLE[sev]}
            onClick={() => void setFilter({ severity: sev })}
          />
        ))}
      </div>

      {findings.length === 0 ? (
        <EmptyState status={status} hasWorkspace={workspace !== null} />
      ) : (
        <VirtualList
          items={findings}
          label="Problems"
          estimateRowHeight={44}
          getKey={(f) => f.id}
          className="min-h-0 flex-1"
          renderItem={(finding) => <FindingRow finding={finding} />}
        />
      )}

      <AiPanel />
    </section>
  );
}

const AI_ACTIONS: readonly { profile: TaskProfile; label: string }[] = [
  { profile: 'explain', label: 'Explain' },
  { profile: 'repair', label: 'Repair' },
  { profile: 'test', label: 'Test' },
];

function SeverityFilter({
  label,
  count,
  active,
  className,
  onClick,
}: {
  label: string;
  count: number | undefined;
  active: boolean;
  className?: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded px-2 py-0.5 text-xs capitalize',
        active ? 'bg-hover text-fg' : 'text-fg-muted hover:text-fg',
        className,
      )}
    >
      {label}
      {count !== undefined && count > 0 && <span className="tabular-nums">{count}</span>}
    </button>
  );
}

function FindingRow({ finding }: { finding: Finding }): React.JSX.Element {
  const selectFile = useWorkspaceStore((s) => s.selectFile);
  const runAi = useAiStore((s) => s.run);
  const aiConfigured = useAiStore((s) => s.config?.configured ?? false);
  const aiBusy = useAiStore((s) => s.status === 'running');

  return (
    <div className="group relative border-b border-border-subtle">
      <button
        type="button"
        onClick={() => {
          selectFile(finding.location.file);
        }}
        title={finding.message}
        className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring focus-visible:outline"
      >
        <span className="flex w-full items-center gap-1.5">
          <AlertIcon className={cn('size-3.5 shrink-0', SEVERITY_STYLE[finding.severity])} />
          <span className="truncate text-xs text-fg">{finding.message}</span>
        </span>
        <span className="pl-5 text-[11px] text-fg-muted">
          {basename(finding.location.file)}:{finding.location.startLine} · {finding.source} (
          {finding.ruleId})
        </span>
      </button>

      {/* AI actions — siblings of the open-file button, not nested (valid HTML). Shown on hover/focus
          within the row, and only when a BYOK key is configured. */}
      <div className="absolute right-2 top-1 hidden items-center gap-1 group-focus-within:flex group-hover:flex">
        {aiConfigured ? (
          AI_ACTIONS.map((action) => (
            <button
              key={action.profile}
              type="button"
              disabled={aiBusy}
              onClick={() => void runAi(action.profile, finding.id)}
              className="rounded bg-canvas px-1.5 py-0.5 text-[11px] text-fg-secondary shadow-sm hover:bg-hover hover:text-fg disabled:opacity-50"
            >
              {action.label}
            </button>
          ))
        ) : (
          <span className="rounded bg-canvas px-1.5 py-0.5 text-[11px] text-fg-muted shadow-sm">
            Add a key in Settings → AI
          </span>
        )}
      </div>
    </div>
  );
}

function EmptyState({
  status,
  hasWorkspace,
}: {
  status: string;
  hasWorkspace: boolean;
}): React.JSX.Element {
  const message = !hasWorkspace
    ? 'Open a folder to analyze it.'
    : status === 'running'
      ? 'Analyzing…'
      : 'No problems found. Run analysis to check this workspace.';
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-fg-muted">
      {message}
    </div>
  );
}
