import {
  classifyFinding,
  isRepairAttemptable,
  repairStateFor,
  REPAIR_STATE_REASON,
  type Finding,
  type RepairMode,
  type TaskProfile,
} from '@fixora/shared-types';
import { AlertIcon, Button, ConfirmDialog, cn } from '@fixora/ui';
import { useId, useState } from 'react';

import { useAiStore } from '../../stores/ai-store.js';
import { useUiStore } from '../../stores/ui-store.js';
import { DEFAULT_REPAIR_MODE, REPAIR_MODES, repairModeInfo } from '../ai/repair-mode.js';
import { useCapability } from '../ai/use-capability.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import {
  CATEGORY_GUIDANCE,
  SOURCE_LABEL,
  docsLinkFor,
  effortFor,
  manualFixFor,
  riskLevelFor,
  whyTriggered,
  type RiskLevel,
} from './finding-guidance.js';
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
  const risk = riskLevelFor(finding);
  const effort = effortFor(finding);
  const manualFix = manualFixFor(finding);
  // One source of truth for "why not repairable" — derived from the same repair state that
  // disables the button, so the two can never disagree.
  const classification = classifyFinding(finding);
  const { file, startLine, startCol } = finding.location;

  const revealAt = useWorkspaceStore((s) => s.revealAt);
  const select = useFindingsStore((s) => s.select);
  const ignore = useFindingsStore((s) => s.ignore);
  const runAi = useAiStore((s) => s.run);
  const aiConfigured = useAiStore((s) => s.config?.configured ?? false);
  const aiBusy = useAiStore((s) => s.status === 'running');
  const setActiveView = useUiStore((s) => s.setActiveView);
  const setModel = useAiStore((s) => s.setModel);
  // One lookup per profile, read from provider metadata via the config.
  const capabilities = {
    explain: useCapability('explain'),
    repair: useCapability('repair', finding.repair),
    test: useCapability('test'),
  };

  const modeId = useId();
  const [mode, setMode] = useState<RepairMode>(DEFAULT_REPAIR_MODE);
  const [confirmAdvanced, setConfirmAdvanced] = useState(false);
  const repairState = repairStateFor(finding);
  // manual-only must not block Repair here either — the same fix findings-panel.tsx already
  // applies. A user who wants to attempt AI repair on a rule an analyzer merely judged ambiguous
  // gets to try; refusing it entirely is a stronger claim than "no analyzer proposed one".
  const repairBlocked = repairState !== 'manual-only' && !isRepairAttemptable(repairState);

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
            revealAt({ ...finding.location, severity: finding.severity });
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

        {/* Risk and effort are both derived, and the footnote under them says so out loud. */}
        <div className="flex flex-wrap gap-2">
          <Metric label="Risk" value={<span className={RISK_STYLE[risk]}>{risk}</span>} />
          <Metric label="Effort" value={effort.label} />
        </div>
        <p className="text-[11px] leading-relaxed text-fg-muted">
          {effort.detail} Risk is derived from severity and category; effort from the rule class and
          how much code this spans. Both are guides, not measurements.
        </p>

        {/* The specific part: why THIS code tripped the rule, not what the rule is in general. */}
        <Section title="Why this code triggered it">{whyTriggered(finding)}</Section>
        <Section title="If you leave it">{guidance.ifIgnored}</Section>

        {/*
          Why this cannot be repaired, stated once and specifically.

          `classifyFinding` derives this from the SAME `repairStateFor` that disables the button, so
          the explanation and the disabled control can never disagree — and a generic "Repair
          disabled" is not reachable: every category carries its own title, reason and next step.
          Repairable findings fall through to the manual-fix guidance below, unchanged.
        */}
        {classification.category !== 'repairable' ? (
          <section className="flex flex-col gap-1.5 rounded border border-warn-border bg-warn-subtle/30 p-2.5">
            <h3 className="text-[11px] font-semibold tracking-wide text-fg uppercase">
              {classification.title}
            </h3>
            <div className="flex flex-col gap-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-fg-muted">Reason</p>
              <p className="text-xs leading-relaxed text-fg-secondary">{classification.reason}</p>
            </div>
            {classification.suggestedFix !== undefined && (
              <div className="flex flex-col gap-0.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-fg-muted">
                  Suggested fix
                </p>
                <pre className="overflow-x-auto rounded border border-border-subtle bg-inset p-2.5 text-[11px] leading-relaxed text-fg-secondary">
                  <code>{classification.suggestedFix}</code>
                </pre>
              </div>
            )}
            {classification.nextStep !== undefined && (
              <p className="text-[11px] leading-relaxed text-fg-muted">{classification.nextStep}</p>
            )}
          </section>
        ) : (
          <section className="flex flex-col gap-1.5">
            <h3 className="text-[11px] font-semibold tracking-wide text-fg uppercase">
              Suggested manual fix
            </h3>
            <p className="text-xs leading-relaxed text-fg-secondary">{manualFix.strategy}</p>
            {manualFix.illustration !== undefined && (
              <>
                <pre className="overflow-x-auto rounded border border-border-subtle bg-inset p-2.5 text-[11px] leading-relaxed text-fg-secondary">
                  <code>{manualFix.illustration}</code>
                </pre>
                {/* Said plainly, because a code block in a repair tool looks like a patch. */}
                <p className="text-[11px] text-fg-muted">
                  An illustration of the pattern — not a rewrite of your code. Use{' '}
                  <span className="text-fg-secondary">Repair</span> for a change generated against
                  this file and verified before you can apply it.
                </p>
              </>
            )}
          </section>
        )}

        <Section title="What this category means">{guidance.what}</Section>

        <p className="text-[11px] leading-relaxed text-fg-muted">
          &ldquo;What this category means&rdquo; describes{' '}
          <span className="text-fg-secondary">{finding.category}</span> problems in general, not
          this rule specifically.
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

      {/* Manual-only guidance. Purely informational — Repair itself is NOT disabled for these (the
          user is entitled to attempt it anyway; see use-capability.ts), this just sets the right
          expectation before they do, since an analyzer marking a rule "manual" is usually right
          that the correct change is a judgment call a model is unlikely to get for free. */}
      {repairState === 'manual-only' && (
        <div className="flex flex-col gap-2 border-t border-border-subtle bg-inset px-3 py-2.5">
          <div className="flex items-start gap-2">
            <AlertIcon className="mt-0.5 size-3.5 shrink-0 text-fg-muted" />
            <p className="text-[11px] leading-relaxed text-fg-secondary [overflow-wrap:anywhere]">
              This finding requires manual refactoring. Use Explain to understand the change
              needed, then edit the file directly.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => {
              revealAt({ ...finding.location, severity: finding.severity });
            }}
          >
            Open in Editor
          </Button>
        </div>
      )}

      {/* Why Repair is unavailable, explained here once, rather than in three tooltips — whether the
          cause is an incapable model (bug-fix sprint: wording no longer assumes it always is) or a
          finding this tool can never auto-fix, like a manual-only rule. */}
      {aiConfigured && !capabilities.repair.enabled && (
        <div className="sticky bottom-[52px] flex flex-col gap-2 border-t border-border-subtle bg-warn-subtle/30 px-3 py-2.5">
          <p className="text-[11px] leading-relaxed text-fg-secondary [overflow-wrap:anywhere]">
            <span className="font-semibold text-fg">Repair is unavailable for this finding.</span>{' '}
            {capabilities.repair.reason}
          </p>
          {capabilities.repair.suggestion !== null && (
            <Button
              variant="primary"
              size="sm"
              className="self-start"
              onClick={() => void setModel(capabilities.repair.suggestion?.id ?? '')}
            >
              Switch to {capabilities.repair.suggestion.name}
              {capabilities.repair.suggestion.free ? ' (free)' : ''}
            </Button>
          )}
        </div>
      )}

      {/*
        The repair mode. Ordered by blast radius, defaulting to the smallest — every step up is an
        explicit choice, never an escalation the app performs for you.
      */}
      {aiConfigured && !repairBlocked && (
        <div className="sticky bottom-[52px] flex flex-col gap-1 border-t border-border-subtle bg-canvas px-3 pt-2.5">
          <label htmlFor={modeId} className="text-[10px] uppercase tracking-wide text-fg-muted">
            Repair scope
          </label>
          <select
            id={modeId}
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as RepairMode);
            }}
            className="w-full rounded border border-border-strong bg-inset px-2 py-1 text-xs text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
          >
            {REPAIR_MODES.map((m) => (
              <option key={m.mode} value={m.mode}>
                {m.label}
              </option>
            ))}
          </select>
          <p className="text-[10px] leading-snug text-fg-muted">
            {repairModeInfo(mode).description}
          </p>
        </div>
      )}

      {/* Actions pinned to the bottom: understand first, then act. */}
      <div className="sticky bottom-0 mt-auto flex flex-wrap items-center gap-1.5 border-t border-border-subtle bg-canvas p-3">
        {aiConfigured ? (
          AI_ACTIONS.map((action) => {
            const cap = capabilities[action.profile];
            return (
              <Button
                key={action.profile}
                variant={action.profile === 'repair' ? 'primary' : 'ghost'}
                size="sm"
                // Disabled BEFORE it is pressed, not after it fails. `title` carries the reason so
                // a disabled control is never silent about why.
                disabled={aiBusy || !cap.enabled || (action.profile === 'repair' && repairBlocked)}
                title={
                  action.profile === 'repair' && repairBlocked
                    ? REPAIR_STATE_REASON[repairState]
                    : cap.enabled
                      ? undefined
                      : cap.reason
                }
                onClick={() => {
                  if (action.profile !== 'repair') {
                    void runAi(action.profile, finding.id);
                    return;
                  }
                  // The advanced mode is never run on a click. It states what it will replace and
                  // waits for a second, deliberate confirmation — the whole-file splice is the
                  // largest edit the app can make.
                  if (repairModeInfo(mode).advanced) {
                    setConfirmAdvanced(true);
                    return;
                  }
                  void runAi('repair', finding.id, mode);
                }}
              >
                {action.label}
              </Button>
            );
          })
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
        {/*
        The advanced mode's gate. It is never run by a click — the whole-file splice is the largest
        edit the app can make, so it states exactly what it will replace and waits for a second,
        deliberate confirmation. Everything after this is still fully verified and previewed.
      */}
        <ConfirmDialog
          open={confirmAdvanced}
          onOpenChange={setConfirmAdvanced}
          title={
            mode === 'advanced'
              ? 'Run Advanced Repair on this file?'
              : 'Run AI File Repair on this whole file?'
          }
          description={repairModeInfo(mode).warning ?? ''}
          confirmLabel={mode === 'advanced' ? 'Fix every problem' : 'Analyze whole file'}
          onConfirm={() => {
            void runAi('repair', finding.id, mode);
          }}
        />

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

const RISK_STYLE: Record<RiskLevel, string> = {
  critical: 'text-danger-text',
  high: 'text-danger-text',
  moderate: 'text-warn-text',
  low: 'text-fg-secondary',
};

/** One derived value, in a bordered chip so it reads as a summary rather than as body text. */
function Metric({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 basis-28 flex-col gap-0.5 rounded border border-border-subtle px-2.5 py-1.5">
      <span className="text-[10px] font-medium tracking-wide text-fg-muted uppercase">{label}</span>
      <span className="truncate text-xs font-medium capitalize text-fg">{value}</span>
    </div>
  );
}

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
  error: 'bg-danger-subtle text-danger-text',
  warning: 'bg-warn-subtle text-warn-text',
  info: 'bg-hover text-fg-muted',
  neutral: 'bg-hover text-fg-secondary',
  success: 'bg-success-subtle text-success-text',
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
