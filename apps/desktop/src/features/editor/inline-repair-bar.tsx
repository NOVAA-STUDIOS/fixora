import { Button, ConfirmDialog, cn } from '@fixora/ui';
import { useState } from 'react';

import { useAiStore } from '../../stores/ai-store.js';
import { useUiStore } from '../../stores/ui-store.js';
import { evaluateApplyGate } from '../ai/apply-diagnostics.js';
import { assessForceApplyRisk, riskLabel } from '../ai/force-apply-risk.js';

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

  const repair = proposal?.profile === 'repair' ? proposal : null;
  const gate = evaluateApplyGate(repair);
  const total = position?.total ?? 0;
  const [confirming, setConfirming] = useState(false);
  const risk = assessForceApplyRisk(repair);

  /**
   * Force Apply is offered whenever there is a patch — including a verified one, where it is simply
   * redundant and Accept is the obvious action. Hiding it when verification passes would make it
   * appear only in the moment of frustration, which is the worst time to meet an unfamiliar control.
   */
  const canForce = repair !== null && repair.repairedCode.length > 0;

  const dialogDescription =
    risk === null
      ? ''
      : [
          risk.headline + '.',
          risk.detail,
          '',
          riskLabel(risk.level) + '. If you apply this anyway:',
          ...risk.consequences.map((c) => '• ' + c),
          '',
          'The file is still checked before it is written: if it changed since this repair was',
          'generated, the write is refused rather than corrupting it.',
        ].join('\n');

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
      {/*
        Force Apply — a separate action, never a relaxation of Accept.

        Accept's `disabled` below is untouched and still comes from `evaluateApplyGate`. This is the
        deliberate override: it is always available when a patch exists, it explains precisely what
        failed and what may happen, and it does nothing until the user confirms. It bypasses the
        VERIFICATION gate only — every write-time protection still runs and can still refuse.
      */}
      {canForce && !gate.enabled && (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-danger-text"
          title="Apply this patch even though verification failed. You will be asked to confirm."
          onClick={() => {
            setConfirming(true);
          }}
        >
          Force Apply
        </Button>
      )}

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

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Apply an unverified repair?"
        description={dialogDescription}
        confirmLabel="Apply anyway"
        destructive
        onConfirm={() => {
          setConfirming(false);
          // The SAME pipeline Accept uses. `forced` is for the audit trail, not for permission.
          void applyRepair({ forced: true });
        }}
      />
    </div>
  );
}
