import { Button } from '@fixora/ui';
import { useEffect } from 'react';

import { invoke } from '../../lib/bridge.js';
import { useUpdateStore } from '../../stores/update-store.js';

/**
 * Auto-update, surfaced as two moments and nothing in between.
 *
 * Deliberately not a `Toast`: those auto-dismiss after ~3s (`toast-store.ts`), which is fine for
 * "your action worked" and wrong here — "downloading" should stay visible for as long as it is
 * true, and "ready to restart" must stay until the user acts on it or closes the app. A fixed,
 * corner-anchored banner is what "non-blocking" means: nothing else on screen shifts or waits for
 * it, and the very same Repair, Explain and Apply flows this app is built around keep working
 * exactly as before while it sits there.
 */
export function UpdateBanner(): React.JSX.Element | null {
  const update = useUpdateStore((s) => s.update);
  const listen = useUpdateStore((s) => s.listen);

  useEffect(() => listen(), [listen]);

  if (update.status === 'idle') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-50 flex max-w-xs items-center gap-3 rounded-lg border border-border-subtle bg-raised px-3 py-2.5 shadow-lg"
    >
      {update.status === 'available' ? (
        <p className="text-xs text-fg-secondary">
          Update <span className="font-mono text-fg">v{update.version}</span> available,
          downloading…
        </p>
      ) : (
        <>
          <p className="text-xs text-fg-secondary">
            Update <span className="font-mono text-fg">v{update.version}</span> ready.
          </p>
          <Button
            variant="primary"
            size="sm"
            className="shrink-0"
            onClick={() => void invoke('update:install', {})}
          >
            Restart to apply
          </Button>
        </>
      )}
    </div>
  );
}
