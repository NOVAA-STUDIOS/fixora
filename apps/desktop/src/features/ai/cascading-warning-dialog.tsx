import { ConfirmDialog } from '@fixora/ui';

import type { ForceApplyRisk } from './force-apply-risk.js';

/**
 * "Cascading Problem Detection" (feature): the verifier already re-runs the real analyzers against
 * the patched file and reports exactly which new findings a repair would introduce — `newFindings`
 * on the verification report, surfaced as `ForceApplyRisk` by `force-apply-risk.ts`. That is a
 * deterministic answer from the same tools the Problems panel trusts everywhere else, so this
 * reuses it rather than asking the model to guess "will this cause new problems?" a second time in
 * plain English — a prompt-based yes/no would be strictly less reliable than the check that already
 * ran, for the cost of an extra provider call.
 *
 * This dialog is the human-in-the-loop step for exactly that signal: shown whenever a repair's own
 * verification found new problems, so the user decides — informed — before anything unverified is
 * written to their file. It is not a new detector, just the first UI surface this data gets.
 */
export function CascadingWarningDialog({
  open,
  risk,
  onFixAnyway,
  onSkip,
}: {
  open: boolean;
  risk: ForceApplyRisk | null;
  onFixAnyway: () => void;
  onSkip: () => void;
}): React.JSX.Element {
  const description =
    risk === null
      ? ''
      : [risk.detail, ...risk.consequences].join(' ');

  return (
    <ConfirmDialog
      open={open && risk !== null}
      onOpenChange={(next) => {
        if (!next) onSkip();
      }}
      title="⚠️ This fix may cause new problems"
      description={description}
      confirmLabel="Fix Anyway"
      cancelLabel="Skip"
      destructive
      onConfirm={onFixAnyway}
    />
  );
}
