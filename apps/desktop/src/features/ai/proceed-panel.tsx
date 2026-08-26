import { Button, cn } from '@fixora/ui';
import { useEffect, useState } from 'react';

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

/** Quick-select suggestions above the instruction textarea. Suggestions only — the user can still
 *  type anything; clicking one just fills the textarea. */
const TEMPLATES: readonly string[] = [
  'Add error handling',
  'Add TypeScript types',
  'Add null checks',
  'Add JSDoc comments',
  'Convert to async/await',
  'Simplify this code',
];

/** Local instruction history, most recent first, capped and deduplicated (FIX 4). Read/write helpers
 *  are exported so `ProceedView` can record a successful run without this file owning store logic. */
const HISTORY_KEY = 'fixora.proceed.history';
const HISTORY_MAX = 10;

export function readProceedHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function pushProceedHistory(instruction: string): void {
  const trimmed = instruction.trim();
  if (trimmed === '') return;
  try {
    const deduped = [trimmed, ...readProceedHistory().filter((entry) => entry !== trimmed)];
    localStorage.setItem(HISTORY_KEY, JSON.stringify(deduped.slice(0, HISTORY_MAX)));
  } catch {
    // localStorage unavailable (private mode, quota) — history is a convenience, never worth failing over.
  }
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
  // -1 = the user's own current input; 0..n-1 indexes into history, newest first (FIX 4).
  const [historyIndex, setHistoryIndex] = useState(-1);
  // What the user had typed before an ArrowUp dipped into history — restored on ArrowDown past index 0.
  const [draft, setDraft] = useState('');
  const trimmed = instruction.trim();
  const canSubmit = trimmed.length > 0 && !busy;

  const submit = (e: React.SyntheticEvent): void => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(trimmed);
    setHistoryIndex(-1);
    setDraft('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    const el = e.currentTarget;
    if (e.key === 'ArrowUp') {
      // Only steal the key when the caret is at the very start (or the box is empty) — otherwise
      // ArrowUp should move the caret within a multi-line instruction like it normally would.
      if (el.selectionStart !== 0 || el.selectionEnd !== 0) return;
      const history = readProceedHistory();
      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) return;
      e.preventDefault();
      if (historyIndex === -1) setDraft(instruction);
      setHistoryIndex(nextIndex);
      setInstruction(history[nextIndex] ?? '');
    } else if (e.key === 'ArrowDown') {
      if (el.selectionStart !== instruction.length || el.selectionEnd !== instruction.length) return;
      if (historyIndex === -1) return;
      e.preventDefault();
      const nextIndex = historyIndex - 1;
      if (nextIndex === -1) {
        setHistoryIndex(-1);
        setInstruction(draft);
        return;
      }
      const history = readProceedHistory();
      setHistoryIndex(nextIndex);
      setInstruction(history[nextIndex] ?? '');
    }
  };

  return (
    <form onSubmit={submit} aria-label="Proceed" className="flex flex-col gap-2 p-3">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-fg-muted">Quick actions:</span>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATES.map((template) => (
            <button
              key={template}
              type="button"
              disabled={busy}
              onClick={() => {
                setInstruction(template);
                setHistoryIndex(-1);
              }}
              className="rounded-full border border-border-subtle px-2 py-0.5 text-[11px] text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-60"
            >
              {template}
            </button>
          ))}
        </div>
      </div>
      <label htmlFor="proceed-instruction" className="text-xs font-medium text-fg-secondary">
        What would you like to change?
      </label>
      <textarea
        id="proceed-instruction"
        value={instruction}
        onChange={(e) => {
          setInstruction(e.target.value);
          setHistoryIndex(-1);
        }}
        onKeyDown={handleKeyDown}
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
  const lastRequest = useProceedStore((s) => s.lastRequest);
  const run = useProceedStore((s) => s.run);
  const retry = useProceedStore((s) => s.retry);
  const accept = useProceedStore((s) => s.accept);
  const cancel = useProceedStore((s) => s.cancel);

  // A verified proposal is the definition of "successful" here — the run answered with a real,
  // gated edit rather than a refusal. Recorded once per request, off `lastRequest` (not `instruction`
  // state, which this component does not hold) so retries never write the same text twice.
  useEffect(() => {
    if (status === 'preview' && lastRequest !== null) pushProceedHistory(lastRequest.instruction);
  }, [status, lastRequest]);

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
