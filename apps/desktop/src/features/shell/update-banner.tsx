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

  const percent = downloadProgress ?? 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 border-b border-accent/20 bg-accent/10 px-3 py-1.5 text-xs text-fg-secondary"
    >
      {/* Version info */}
      <span className="shrink-0 font-medium text-accent">v{update.version}</span>

      {/* Progress bar */}
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-border-subtle">
        <div
          className="h-full rounded-full bg-accent transition-all duration-500"
          style={{ width: `${String(percent)}%` }}
        />
      </div>

      {/* Percent, or a placeholder before it's meaningful */}
      {percent < 5 ? (
        <span className="shrink-0">Downloading update…</span>
      ) : (
        <span className="shrink-0 tabular-nums">{Math.round(percent)}%</span>
      )}
    </div>
  );
}
