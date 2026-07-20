import { cn } from '@fixora/ui';

import { useAiStore } from '../../stores/ai-store.js';
import { useEditorStore } from '../editor/editor-store.js';
import { cachedModelPaths } from '../editor/models.js';
import { useFindingsStore } from '../findings/findings-store.js';
import { useHistoryStore } from '../history/history-store.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

/**
 * Workspace Diagnostics — debugging only.
 *
 * Built for the P0 attribution sprint. The database proved correctly partitioned and the queries
 * correctly scoped, yet a project's findings could still appear under another project's name,
 * because the leak was in renderer state that no database test can see. This panel makes that state
 * observable: every workspace-scoped store, side by side with the workspace they are supposed to
 * belong to, so "is anything left over from the last project?" is answerable by looking.
 *
 * It is deliberately not on the activity rail. It is reached from the command palette, because a
 * debugging surface that ships in the main navigation stops being a debugging surface.
 *
 * Every row is read live from the store it describes. Nothing here is cached or derived from a
 * snapshot — a diagnostics panel showing stale data would be worse than none.
 */
export function WorkspaceDiagnostics(): React.JSX.Element {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const nodes = useWorkspaceStore((s) => s.nodes);
  const selectedFile = useWorkspaceStore((s) => s.selectedFile);

  const findings = useFindingsStore((s) => s.findings);
  const analysisStatus = useFindingsStore((s) => s.status);
  const summary = useFindingsStore((s) => s.summary);
  const selectedFinding = useFindingsStore((s) => s.selectedId);

  const tabs = useEditorStore((s) => s.tabs);
  const dirty = useEditorStore((s) => s.dirty);

  const proposal = useAiStore((s) => s.proposal);
  const aiStatus = useAiStore((s) => s.status);
  const lastApply = useAiStore((s) => s.lastApplyAttempt);

  const history = useHistoryStore((s) => s.entries);
  const historyLoaded = useHistoryStore((s) => s.loaded);

  const models = cachedModelPaths();

  // A finding whose path is not in the tree is the exact symptom this sprint chased. Cheap to
  // compute, and the single most useful line on the panel.
  const treePaths = new Set(nodes.map((n) => n.relPath));
  const orphanFindings =
    workspace === null
      ? []
      : findings.filter((f) => {
          const top = f.location.file.split('/')[0] ?? '';
          return treePaths.size > 0 && !treePaths.has(top) && !treePaths.has(f.location.file);
        });

  const noWorkspace = workspace === null;

  return (
    <section
      aria-label="Workspace diagnostics"
      className="flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-subtle bg-raised"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-6">
        <h2 className="text-sm font-semibold text-fg">Workspace diagnostics</h2>
        <span className="rounded bg-inset px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-fg-muted">
          debug only
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-6">
          {/* The headline check. Everything below is the evidence for it. */}
          <div
            className={cn(
              'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm',
              orphanFindings.length === 0
                ? 'border-success-border bg-success-subtle/30 text-success-text'
                : 'border-danger-border bg-danger-subtle/30 text-danger-text',
            )}
          >
            <span className="font-semibold">
              {orphanFindings.length === 0
                ? 'No findings outside the current workspace tree'
                : `${String(orphanFindings.length)} finding(s) reference paths not in this workspace`}
            </span>
          </div>

          <Group title="Active workspace">
            <Row label="Workspace ID" value={workspace?.id ?? '(none open)'} mono />
            <Row label="Path" value={workspace?.rootPath ?? '(none open)'} mono wrap />
            <Row label="Name" value={workspace?.name ?? '—'} />
            <Row label="Tree nodes loaded" value={String(nodes.length)} />
            <Row label="Selected file" value={selectedFile ?? '—'} mono wrap />
          </Group>

          <Group title="Analysis session">
            <Row label="Status" value={analysisStatus} />
            <Row label="Findings in memory" value={String(findings.length)} />
            <Row
              label="Summary total"
              value={summary === null ? 'not analyzed' : String(summary.total)}
            />
            <Row label="Selected finding" value={selectedFinding ?? '—'} mono wrap />
            <Row
              label="Scope"
              value={
                noWorkspace
                  ? 'no workspace — analysis:list would error'
                  : `main scopes to ${workspace.id} via requireRoot()`
              }
              wrap
            />
          </Group>

          <Group title="Cache state">
            {/* Keyed by workspace-RELATIVE path, so it must be emptied on every switch: two projects
                can both contain src/index.ts, and the stale one would win. */}
            <Row label="Monaco models cached" value={String(models.length)} />
            <Row label="Open editor tabs" value={String(tabs.length)} />
            <Row label="Unsaved files" value={String(dirty.length)} />
            {models.length > 0 && (
              <Row label="Cached paths" value={models.slice(0, 6).join(', ')} mono wrap />
            )}
          </Group>

          <Group title="Repair scope">
            <Row label="AI status" value={aiStatus} />
            <Row
              label="Active proposal"
              value={
                proposal === null
                  ? '—'
                  : proposal.profile === 'repair'
                    ? `repair → ${proposal.target.file}:${String(proposal.target.startLine)}`
                    : proposal.profile
              }
              mono
              wrap
            />
            <Row
              label="Last apply target"
              value={lastApply === null ? '—' : lastApply.request.file}
              mono
              wrap
            />
          </Group>

          <Group title="History scope">
            <Row label="Loaded" value={String(historyLoaded)} />
            <Row label="Entries in memory" value={String(history.length)} />
            <Row
              label="Scope"
              value={
                noWorkspace
                  ? 'no workspace — ai:history returns []'
                  : `main scopes to ${workspace.id}`
              }
              wrap
            />
          </Group>
        </div>
      </div>
    </section>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-inset p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{title}</h3>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  );
}

function Row({
  label,
  value,
  mono = false,
  wrap = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wrap?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex gap-3 text-[11px]">
      <span className="w-40 shrink-0 text-fg-muted">{label}</span>
      <span
        className={cn(
          'min-w-0 flex-1 text-fg-secondary',
          mono && 'font-mono',
          wrap ? '[overflow-wrap:anywhere]' : 'truncate',
        )}
      >
        {value}
      </span>
    </div>
  );
}
