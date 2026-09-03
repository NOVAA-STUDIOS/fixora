import { useEffect } from 'react';

import { useUpdateStore } from '../../stores/update-store.js';

/**
 * Auto-update, downloading moment only: a thin, minimal progress line — no percent number, no
 * narration to watch and worry about. "Ready to restart" is the only real decision point, and it
 * already has its own surface: the status bar's update pill (`status-bar.tsx`'s
 * `UpdateReadyPill`) plus its modal.
 */
export function UpdateBanner(): React.JSX.Element | null {
  const update = useUpdateStore((s) => s.update);
  const listen = useUpdateStore((s) => s.listen);
  const downloadProgress = useUpdateStore((s) => s.downloadProgress);

  useEffect(() => listen(), [listen]);

  if (update.status !== 'available') return null;
  if (downloadProgress !== null && downloadProgress >= 100) return null;

  return (
    <div className="h-0.5 w-full shrink-0 bg-border-subtle">
      <div
        className="h-full bg-accent transition-all duration-300 ease-out"
        style={{ width: `${String(downloadProgress ?? 0)}%` }}
      />
    </div>
  );
}
