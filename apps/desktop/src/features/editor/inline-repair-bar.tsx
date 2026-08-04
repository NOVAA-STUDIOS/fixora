import { Button, cn } from '@fixora/ui';

import { useAiStore } from '../../stores/ai-store.js';
import { useUiStore } from '../../stores/ui-store.js';
import { evaluateApplyGate } from '../ai/apply-diagnostics.js';

/**
 * The inline review controls — Accept, Reject, and movement between edits — pinned over the editor.
 *
 * This is the whole point of the editor-first workflow: the decision is made on the change, without
 * moving to a panel. It sits over the editor rather than inside Monaco's DOM so it is ordinary React
 * (themed, responsive, testable) instead of a hand-built content widget.
 *
 * **It decides nothing.** `enabled` comes from `evaluateApplyGate`, the same pure function the panel
 * used, reading the same verification report. Accept calls the same `applyRepair()`; Reject calls the
 * same `dismiss()`. A repair the verifier rejected is just as unappliable here as it was in the
 * panel, and for the same stated reason.
 */
export function InlineRepairBar({
  position,
  onNext,
  onPrevious,
}: {
  position: { index: number; total: number } | null;
  onNext: () => void;
  onPrevious: () => void;
}): React.JSX.Element {
  const proposal = useAiStore((s) => s.proposal);
  const applyRepair = useAiStore((s) => s.applyRepair);
  const dismiss = useAiStore((s) => s.dismiss);
  const openFullDiff = useUiStore((s) => s.openFullDiff);

  const repair = proposal !== null && proposal.profile === 'repair' ? proposal : null;
  const gate = evaluateApplyGate(repair);
  const total = position?.total ?? 0;

  return (
    <div
      role="toolbar"
      aria-label="Repair review"
      className="pointer-events-auto absolute right-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1.5 rounded-lg border border-border-strong bg-raised/95 px-2 py-1.5 shadow-lg backdrop-blur"
    >
      <span className="mr-0.5 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
        Proposed fix
      </span>

      {total > 1 && (
        <span className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-label="Previous edit"
            onClick={onPrevious}
            className="rounded px-1.5 py-0.5 text-xs text-fg-secondary hover:bg-inset hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
          >
            ‹
          </button>
          <span className="font-mono text-[10px] tabular-nums text-fg-muted">
            {String((position?.index ?? 0) + 1)}/{String(total)}
          </span>
          <button
            type="button"
            aria-label="Next edit"
            onClick={onNext}
            className="rounded px-1.5 py-0.5 text-xs text-fg-secondary hover:bg-inset hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
          >
            ›
          </button>
        </span>
      )}

      <button
        type="button"
        onClick={openFullDiff}
        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
      >
        Open Full Diff
      </button>

      <Button
        variant="ghost"
        size="sm"
        className="shrink-0"
        onClick={() => {
          dismiss();
        }}
      >
        Reject
      </Button>
      <Button
        variant="primary"
        size="sm"
        className={cn('shrink-0')}
        disabled={!gate.enabled}
        title={gate.enabled ? gate.explanation : `Apply is disabled: ${gate.explanation}`}
        onClick={() => void applyRepair()}
      >
        Accept
      </Button>
    </div>
  );
}
