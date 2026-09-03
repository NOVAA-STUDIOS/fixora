import { useEffect } from 'react';

import { useUpdateStore } from '../../stores/update-store.js';

/**
 * Auto-update, downloading moment only. "Ready to restart" is the only real decision point, and
 * it already has its own surface: the status bar's update pill (`status-bar.tsx`'s
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
    <div className="flex shrink-0 items-center gap-3 border-b border-accent/20 bg-accent/10 px-4 py-1.5">
      {/* Label */}
      <span className="shrink-0 text-xs font-medium text-accent">Downloading update...</span>

      {/* Progress bar */}
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border-subtle">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300 ease-out"
          style={{ width: `${String(downloadProgress ?? 0)}%` }}
        />
      </div>

      {/* Percentage */}
      <span className="shrink-0 text-xs tabular-nums text-fg-secondary">
        {Math.round(downloadProgress ?? 0)}%
      </span>
    </div>
  );
}
