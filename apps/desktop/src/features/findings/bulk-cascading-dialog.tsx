import { CascadingWarningDialog } from '../ai/cascading-warning-dialog.js';

import { useBulkRepairStore } from './bulk-repair-store.js';

/**
 * The bulk queue's cascading-warning dialog, mounted at the APP ROOT rather than inside the Group
 * Repair panel.
 *
 * It used to live inside that panel's `<Dialog>`, which unmounts its whole subtree when closed —
 * so closing Group Repair while a repair was paused awaiting Fix Anyway/Skip took the prompt away
 * with it, and the queue sat on an `await` nobody could answer. The pause is queue state, not panel
 * state; it belongs wherever the queue is visible, which is everywhere.
 */
export function BulkCascadingDialog(): React.JSX.Element {
  const cascadingPause = useBulkRepairStore((s) => s.cascadingPause);
  const resolveCascading = useBulkRepairStore((s) => s.resolveCascading);

  return (
    <CascadingWarningDialog
      open={cascadingPause !== null}
      risk={cascadingPause?.risk ?? null}
      onFixAnyway={() => {
        resolveCascading(true);
      }}
      onSkip={() => {
        resolveCascading(false);
      }}
    />
  );
}
