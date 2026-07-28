import { Button, cn } from '@fixora/ui';
import { useState } from 'react';

import { useProceedStore } from '../../stores/proceed-store.js';

/**
 * Proceed Mode — minimal UI (P2.1, objective 8).
 *
 * The "simple prompt input" and nothing more: no redesign, no animation, no advanced UX. Editing modes
 * become Repair / Proceed / Explain; Repair is unchanged, Explain is a placeholder. This component is
 * intentionally dumb — it collects the instruction and hands it to `onSubmit`; the verified editing
 * pipeline lives entirely in main (proceed-service). Kept self-contained and unit-tested so it cannot
 * regress the existing Repair panel.
 */

export type EditMode = 'repair' | 'proceed' | 'explain';

export interface EditModeTabsProps {
  active: EditMode;
  onChange: (mode: EditMode) => void;
}

/**
 * The Repair / Proceed / Explain switch. Explain is a placeholder (disabled) for now.
 *
 * Styled with the app's own tokens, mirroring the severity-filter segmented control in the findings
 * panel. The first version shipped bare <button>s with no classes: in a Tailwind + design-token app
 * they inherit nothing, so the three tabs rendered as one run-together line of plain text with no
 * active state — present in the DOM, but unreadable as tabs and indistinguishable from a header.
 */
export function EditModeTabs({ active, onChange }: EditModeTabsProps): React.JSX.Element {
  const modes: readonly { id: EditMode; label: string; disabled?: boolean }[] = [
    { id: 'repair', label: 'Repair' },
    { id: 'proceed', label: 'Proceed' },
    { id: 'explain', label: 'Explain', disabled: true },
  ];
  return (
    <div
      role="tablist"
      aria-label="Editing mode"
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border-subtle px-2"
    >
      {modes.map((m) => {
        const disabled = m.disabled === true;
        return (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={active === m.id}
            disabled={disabled}
            onClick={() => {
              onChange(m.id);
            }}
            className={cn(
              'rounded px-2 py-0.5 text-xs font-medium',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
              disabled && 'cursor-not-allowed text-fg-muted opacity-60',
              !disabled && active === m.id && 'bg-hover text-fg',
              !disabled && active !== m.id && 'text-fg-muted hover:text-fg',
            )}
          >
            {m.label}
            {disabled ? ' (soon)' : ''}
          </button>
        );
      })}
    </div>
  );
}

export interface ProceedPanelProps {
  /** Called with the trimmed instruction when the user submits a non-empty request. */
  onSubmit: (instruction: string) => void;
  /** True while an edit is being generated/verified — disables the input and submit. */
  busy?: boolean;
  /** Aborts the in-flight request (Q3 Defect #4). Only rendered while `busy`. */
  onCancel?: () => void;
}

export function ProceedPanel({
  onSubmit,
  busy = false,
  onCancel,
}: ProceedPanelProps): React.JSX.Element {
  const [instruction, setInstruction] = useState('');
  const trimmed = instruction.trim();
  const canSubmit = trimmed.length > 0 && !busy;

  const submit = (e: React.SyntheticEvent): void => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(trimmed);
  };

  return (
    <form onSubmit={submit} aria-label="Proceed" className="flex flex-col gap-2 p-3">
      <label htmlFor="proceed-instruction" className="text-xs font-medium text-fg-secondary">
        What would you like to change?
      </label>
      <textarea
        id="proceed-instruction"
        value={instruction}
        onChange={(e) => {
          setInstruction(e.target.value);
        }}
        placeholder="e.g. make this button green, rename this variable, add a loading state"
        rows={3}
        disabled={busy}
        className="w-full resize-y rounded border border-border-subtle bg-base p-2 text-xs text-fg placeholder:text-fg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring disabled:opacity-60"
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={!canSubmit} className="self-start">
          {busy ? 'Working…' : 'Proceed'}
        </Button>
        {busy && onCancel !== undefined && (
          <Button type="button" variant="ghost" className="self-start" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * The connected Proceed view: prompt → run → progress → preview → Accept / Cancel.
 *
 * Preview is deliberately plain (original above, proposed below) — no redesign, and no new diff
 * component: the proposal it shows has ALREADY passed the same verification the Repair path uses, so
 * this is a confirmation step, not a second gate. Accept goes through `ai:applyRepair`; Cancel just
 * discards the proposal, having written nothing.
 */
export function ProceedView(): React.JSX.Element {
  const status = useProceedStore((s) => s.status);
  const proposal = useProceedStore((s) => s.proposal);
  const message = useProceedStore((s) => s.message);
  const applying = useProceedStore((s) => s.applying);
  const retryable = useProceedStore((s) => s.retryable);
  const run = useProceedStore((s) => s.run);
  const retry = useProceedStore((s) => s.retry);
  const accept = useProceedStore((s) => s.accept);
  const cancel = useProceedStore((s) => s.cancel);

  if (status === 'preview' && proposal !== null) {
    return (
      <section
        aria-label="Proceed preview"
        className="flex h-full min-h-0 flex-col overflow-y-auto"
      >
        <div className="flex flex-col gap-1 border-b border-border-subtle p-3">
          <p className="text-sm font-medium text-fg">{proposal.summary}</p>
          <p className="text-[11px] text-fg-muted">
            {proposal.target.file}
            {proposal.target.symbolName !== null ? ` — ${proposal.target.symbolName}` : ''} · lines{' '}
            {proposal.target.startLine}–{proposal.target.endLine} · verified:{' '}
            {proposal.verification.verdict}
          </p>
        </div>
        <div className="flex flex-col gap-1 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-secondary">
            Original
          </p>
          <pre className="overflow-x-auto rounded border border-border-subtle bg-base p-2 font-mono text-[11px] text-fg-muted">
            {proposal.originalCode}
          </pre>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-fg-secondary">
            Proposed edit
          </p>
          <pre className="overflow-x-auto rounded border border-border-subtle bg-base p-2 font-mono text-[11px] text-fg">
            {proposal.editedCode}
          </pre>
        </div>
        <div className="flex shrink-0 gap-2 border-t border-border-subtle p-3">
          <Button type="button" disabled={applying} onClick={() => void accept()}>
            {applying ? 'Applying…' : 'Accept'}
          </Button>
          <Button type="button" variant="ghost" disabled={applying} onClick={() => void cancel()}>
            Cancel
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Proceed" className="flex h-full min-h-0 flex-col overflow-y-auto">
      <ProceedPanel
        busy={status === 'running'}
        onSubmit={(instruction) => void run(instruction)}
        onCancel={() => void cancel()}
      />
      {message !== null && (
        <div className="flex flex-col items-start gap-2 px-3 pb-3">
          {/* whitespace-pre-line: the diagnostic tail (detected intent / language) is newline-separated. */}
          <p role="alert" className="whitespace-pre-line text-xs text-fg-muted">
            {message}
          </p>
          {retryable && (
            <Button type="button" variant="ghost" onClick={() => void retry()}>
              Retry
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
