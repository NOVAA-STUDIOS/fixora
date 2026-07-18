import type { Finding, TaskProfile } from '@fixora/shared-types';
import { Button, cn } from '@fixora/ui';

import { useAiStore } from '../../stores/ai-store.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { CATEGORY_GUIDANCE, SOURCE_LABEL, docsLinkFor } from './finding-guidance.js';
import { useFindingsStore } from './findings-store.js';

/**
 * The problem details view: everything Fixora knows about one finding, so a developer understands
 * it *before* spending a token on it. It lives in the assistant pane — wider than the problems
 * list, and directly above the buttons that act on what it says.
 *
 * The split is deliberate and visible to the user: **facts** (rule, location, snippet, confidence)
 * come from the analyzer and are stated flatly; **guidance** is per-category and labelled as
 * general, because we do not have per-rule knowledge and will not fake it; the **rule-specific**
 * answer is one click away as either the tool's own docs or Explain.
 */
export function ProblemDetails({ finding }: { finding: Finding }): React.JSX.Element {
  const guidance = CATEGORY_GUIDANCE[finding.category];
  const docs = docsLinkFor(finding);
  const { file, startLine, startCol } = finding.location;

  const revealAt = useWorkspaceStore((s) => s.revealAt);
  const select = useFindingsStore((s) => s.select);
  const ignore = useFindingsStore((s) => s.ignore);
  const runAi = useAiStore((s) => s.run);
  const aiConfigured = useAiStore((s) => s.config?.configured ?? false);
  const aiBusy = useAiStore((s) => s.status === 'running');
  const setActiveView = useUiStore((s) => s.setActiveView);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto">
      <div className="flex flex-col gap-3 p-4">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={finding.severity}>{finding.severity}</Badge>
            <Badge tone="neutral">{finding.category}</Badge>
            {finding.fixable && (
              <Badge tone="success">Fixable by {SOURCE_LABEL[finding.source]}</Badge>
            )}
          </div>
          <h2 className="text-sm leading-snug font-medium text-fg">{finding.message}</h2>
          <p className="text-xs break-words text-fg-muted">
            {SOURCE_LABEL[finding.source]} · <span className="font-mono">{finding.ruleId}</span>
          </p>
        </header>

        {/* Location — clickable, because the first thing you want is to be *at* the code. */}
        <button
          type="button"
          onClick={() => {
            revealAt(finding.location);
          }}
          className="rounded border border-border-subtle px-2.5 py-1.5 text-left text-xs hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
        >
          <span className="font-mono break-all text-fg-secondary">{file}</span>
          <span className="text-fg-muted">
            {' '}
            line {startLine}, column {startCol}
          </span>
          {finding.evidence.enclosingSymbol !== undefined && (
            <span className="block pt-0.5 text-fg-muted">
              in {finding.evidence.enclosingSymbol.kind}{' '}
              <span className="font-mono">{finding.evidence.enclosingSymbol.name}</span>
            </span>
          )}
        </button>

        {finding.evidence.snippet !== '' && (
          <pre className="overflow-x-auto rounded border border-border-subtle bg-inset p-2.5 text-[11px] leading-relaxed text-fg-secondary">
            <code>{finding.evidence.snippet}</code>
          </pre>
        )}

        {/* Guidance. Honest framing: this is what the *category* means, not a per-rule claim. */}
        <Section title="What this means">{guidance.what}</Section>
        <Section title="If you leave it">{guidance.ifIgnored}</Section>
        <Section title="How fixes usually look">{guidance.fix}</Section>

        <p className="text-[11px] leading-relaxed text-fg-muted">
          The three notes above describe{' '}
          <span className="text-fg-secondary">{finding.category}</span> problems in general.
          {docs !== null
            ? ' For what this exact rule checks, see the docs below, or ask'
            : ' For what this exact rule checks in your code, ask'}{' '}
          <span className="text-fg-secondary">Explain</span> — it reads the real code around line{' '}
          {startLine}.
        </p>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
          <dt className="text-fg-muted">Confidence</dt>
          <dd className="text-fg-secondary">
            {finding.confidence >= 1
              ? 'Certain — reported by a deterministic tool, not a model'
              : `${String(Math.round(finding.confidence * 100))}%`}
          </dd>
          <dt className="text-fg-muted">Autofix</dt>
          <dd className="text-fg-secondary">
            {finding.fixable
              ? `${SOURCE_LABEL[finding.source]} can fix this itself`
              : 'No automatic fix from the tool'}
          </dd>
        </dl>

        {docs !== null && (
          <a
            href={docs.href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-xs text-accent-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
          >
            {docs.label} ↗
          </a>
        )}
      </div>

      {/* Actions pinned to the bottom: understand first, then act. */}
      <div className="sticky bottom-0 mt-auto flex flex-wrap items-center gap-1.5 border-t border-border-subtle bg-canvas p-3">
        {aiConfigured ? (
          AI_ACTIONS.map((action) => (
            <Button
              key={action.profile}
              variant={action.profile === 'repair' ? 'primary' : 'ghost'}
              size="sm"
              disabled={aiBusy}
              onClick={() => void runAi(action.profile, finding.id)}
            >
              {action.label}
            </Button>
          ))
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setActiveView('settings');
            }}
          >
            Set up AI to repair
          </Button>
        )}
        <button
          type="button"
          onClick={() => {
            ignore(finding.id);
            select(null);
          }}
          className="ml-auto rounded px-2 py-1 text-xs text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
        >
          Ignore
        </button>
      </div>
    </div>
  );
}

const AI_ACTIONS: readonly { profile: TaskProfile; label: string }[] = [
  { profile: 'explain', label: 'Explain' },
  { profile: 'repair', label: 'Repair' },
  { profile: 'test', label: 'Generate test' },
];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-0.5">
      <h3 className="text-[11px] font-semibold tracking-wide text-fg uppercase">{title}</h3>
      <p className="text-xs leading-relaxed text-fg-secondary">{children}</p>
    </section>
  );
}

const BADGE_TONE = {
  error: 'bg-danger-bg text-danger-text',
  warning: 'bg-warning-bg text-warning-text',
  info: 'bg-hover text-fg-muted',
  neutral: 'bg-hover text-fg-secondary',
  success: 'bg-success-bg text-success-text',
} as const;

function Badge({
  tone,
  children,
}: {
  tone: keyof typeof BADGE_TONE;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span
      className={cn('rounded px-1.5 py-px text-[10px] font-medium capitalize', BADGE_TONE[tone])}
    >
      {children}
    </span>
  );
}
