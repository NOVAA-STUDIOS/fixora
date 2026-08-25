import { useEffect } from 'react';

import { useUpdateStore } from '../../stores/update-store.js';

/**
 * Auto-update, downloading moment only. "Ready to restart" moved to the status bar's update pill
 * (`status-bar.tsx`'s `UpdateReadyPill`) plus its modal — this banner now covers exactly the
 * unobtrusive, nothing-to-do-yet state: a fixed, corner-anchored strip that says a download is in
 * progress and disappears the moment there is a decision to make.
 */
export function UpdateBanner(): React.JSX.Element | null {
  const update = useUpdateStore((s) => s.update);
  const listen = useUpdateStore((s) => s.listen);
  const downloadProgress = useUpdateStore((s) => s.downloadProgress);

  useEffect(() => listen(), [listen]);

  if (update.status !== 'available') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-4 right-4 z-50 flex max-w-xs items-center gap-3 rounded-lg border border-border-subtle bg-raised px-3 py-2.5 shadow-lg"
    >
      <p className="text-xs text-fg-secondary">
        Update <span className="font-mono text-fg">v{update.version}</span> available, downloading
        {downloadProgress !== null ? ` (${String(Math.round(downloadProgress))}%)` : '…'}
      </p>
    </div>
  );
}
