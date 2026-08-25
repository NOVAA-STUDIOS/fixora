import { useEffect, useState } from 'react';

import { subscribe } from '../../lib/bridge.js';

import { WhatsNewDialog } from './whats-new-dialog.js';

/**
 * Auto-opens What's New exactly once per update — main only emits `app:justUpdated` when a
 * previously-recorded version differs from this one (never on a fresh install; see
 * `last-launched-version.ts`). Dismissed state lives in this component's own state, not persisted:
 * the whole point is that the NEXT update shows it again.
 */
export function PostUpdateWhatsNew(): React.JSX.Element {
  const [open, setOpen] = useState(false);

  useEffect(
    () =>
      subscribe('app:justUpdated', () => {
        setOpen(true);
      }),
    [],
  );

  return <WhatsNewDialog open={open} onOpenChange={setOpen} />;
}
