import { SUGGESTION_CATEGORY_LABELS, type Suggestion } from '@fixora/shared-types';
import {
  Badge,
  Button,
  CloseIcon,
  ConfirmDialog,
  DownloadIcon,
  LightbulbIcon,
  SendIcon,
  Skeleton,
} from '@fixora/ui';
import { useState } from 'react';

/**
 * The local history of everything the user has submitted (Sprint F1) — same "it's your record, you
 * curate it" discipline as `HistoryPanel`: per-row delete, and Clear all behind a confirmation
 * because it is destructive and cannot be undone from the UI. Sprint F1.1 adds per-row sharing: a
 * suggestion is stored locally only, and "Email to Fixora" (Sprint F1.3; formerly "Share with
 * Fixora") is the one deliberate action that ever sends it anywhere.
 */
export function SuggestionHistory({
  suggestions,
  loaded,
  onRemove,
  onClear,
  onExport,
  onShare,
}: {
  suggestions: Suggestion[];
  loaded: boolean;
  onRemove: (id: string) => void;
  onClear: () => void;
  onExport: () => void;
  onShare: (id: string) => void;
}): React.JSX.Element {
  const [confirmClear, setConfirmClear] = useState(false);

  if (!loaded) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (suggestions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-subtle py-10 text-center">
        <LightbulbIcon className="size-6 text-fg-muted" />
        <p className="text-sm text-fg-muted">Nothing submitted yet — your suggestions land here.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">
          Your suggestions ({suggestions.length})
        </h3>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onExport}
          >
            <DownloadIcon className="size-4" />
            Export JSON
          </Button>
          <button
            type="button"
            onClick={() => {
              setConfirmClear(true);
            }}
            className="text-xs text-fg-muted transition-colors duration-(--fx-motion-duration-fast) hover:text-fg"
          >
            Clear all
          </button>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {suggestions.map((s) => (
          <li
            key={s.id}
            className="group relative flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-inset px-3 py-2.5"
          >
            <div className="flex items-center gap-2">
              <Badge>{SUGGESTION_CATEGORY_LABELS[s.category]}</Badge>
              <span className="ml-auto text-[11px] tabular-nums text-fg-muted transition-opacity duration-(--fx-motion-duration-fast) group-hover:opacity-0">
                {relativeTime(s.createdAt)}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{s.message}</p>
            <div className="flex items-center justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onShare(s.id);
                }}
              >
                <SendIcon className="size-3.5" />
                Email to Fixora
              </Button>
            </div>
            <button
              type="button"
              onClick={() => {
                onRemove(s.id);
              }}
              aria-label="Delete this suggestion"
              className="absolute right-2 top-2 rounded-md p-1 text-fg-muted opacity-0 transition-opacity duration-(--fx-motion-duration-fast) hover:bg-danger-subtle hover:text-danger-text group-hover:opacity-100 focus-visible:opacity-100"
            >
              <CloseIcon className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear all suggestions?"
        description="This permanently deletes every suggestion stored locally. Export them first if you want to keep a copy."
        confirmLabel="Clear all"
        onConfirm={onClear}
      />
    </div>
  );
}

function relativeTime(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${String(days)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
