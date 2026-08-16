import { Dialog, DialogContent, DialogTitle } from '@fixora/ui';
import { useEffect, useState } from 'react';

import { invoke } from '../../lib/bridge.js';

/**
 * The What's New quick action (Sprint F2: Welcome Experience).
 *
 * Release notes only — not a live fetch of `CHANGELOG.md` (no Markdown-rendering dependency in this
 * app), a GitHub Releases fetch instead, parsed and categorized by `ChangelogBody` below.
 */

type ChangelogEntry = { version: string; date: string; body: string };
type ChangelogState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; releases: ChangelogEntry[] };

// Module-level, not component state: the dialog unmounts on close, so a per-component cache
// would refetch on every reopen — the whole point of caching for the session.
let changelogCache: ChangelogEntry[] | null = null;

/** Test-only: the cache is otherwise session-lifetime by design, so tests need a way back to a
 * clean slate between cases. Not called anywhere in production code. */
export function __resetChangelogCacheForTests(): void {
  changelogCache = null;
}

export function WhatsNewDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [changelog, setChangelog] = useState<ChangelogState>(
    changelogCache !== null ? { status: 'ready', releases: changelogCache } : { status: 'loading' },
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    if (changelogCache === null) {
      setChangelog({ status: 'loading' });
      void invoke('system:getChangelog', {}).then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          setChangelog({ status: 'error' });
          return;
        }
        changelogCache = r.value.releases;
        setChangelog({ status: 'ready', releases: r.value.releases });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <div className="flex flex-col gap-1 pb-4">
          <DialogTitle className="text-base font-semibold text-fg">What&apos;s new</DialogTitle>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Release notes
          </span>
          <ChangelogBody state={changelog} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

type NoteCategory = 'ui' | 'new' | 'perf' | 'fixed' | 'other';
const CATEGORY_META: Record<NoteCategory, { icon: string; label: string }> = {
  ui: { icon: '🎨', label: 'UI' },
  new: { icon: '✨', label: 'New' },
  perf: { icon: '⚡', label: 'Performance' },
  fixed: { icon: '🔧', label: 'Fixed' },
  other: { icon: '📦', label: 'Other' },
};
const CATEGORY_ORDER: NoteCategory[] = ['new', 'ui', 'perf', 'fixed', 'other'];

/**
 * A GitHub release body is a Markdown bullet list of raw conventional-commit subjects — this app
 * has no Markdown renderer (see the module doc) and a user should never see `feat(repair):` or a
 * trailing ` by @user in #123`. Parsed, not rendered: bucket by prefix, strip everything that isn't
 * the human sentence.
 */
function parseNotes(body: string): Map<NoteCategory, string[]> {
  const buckets = new Map<NoteCategory, string[]>();
  for (const raw of body.split('\n')) {
    const line = raw.replace(/^[-*]\s*/, '').trim();
    if (line === '') continue;
    const match = /^(feat|perf|fix)(\(([^)]*)\))?:\s*(.+)$/i.exec(line);
    const text = (match?.[4] ?? line)
      .replace(/\s*\(#\d+\)\s*$/, '')
      .replace(/\s+by\s+@[\w-]+(\s+in\s+#\d+)?\s*$/i, '')
      .trim();
    if (text === '') continue;
    const scope = match?.[3]?.toLowerCase() ?? '';
    const kind = match?.[1]?.toLowerCase();
    const category: NoteCategory =
      kind === 'feat' && scope.includes('ui')
        ? 'ui'
        : kind === 'feat'
          ? 'new'
          : kind === 'perf'
            ? 'perf'
            : kind === 'fix'
              ? 'fixed'
              : 'other';
    const bucket = buckets.get(category) ?? [];
    bucket.push(text);
    buckets.set(category, bucket);
  }
  return buckets;
}

const VISIBLE_PER_CATEGORY = 4;

function NoteCategorySection({
  category,
  items,
}: {
  category: NoteCategory;
  items: string[];
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const meta = CATEGORY_META[category];
  const visible = expanded ? items : items.slice(0, VISIBLE_PER_CATEGORY);
  const hidden = items.length - visible.length;
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-[11px] font-semibold tracking-wide text-fg-muted uppercase">
        {meta.icon} {meta.label}
      </h4>
      <ul className="flex flex-col gap-1">
        {visible.map((text) => (
          <li key={text} className="text-[13px] leading-relaxed text-fg-secondary">
            {text}
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => {
            setExpanded(true);
          }}
          className="self-start text-[11px] text-accent-text hover:underline"
        >
          Show {hidden} more
        </button>
      )}
    </div>
  );
}

function ChangelogBody({ state }: { state: ChangelogState }): React.JSX.Element {
  if (state.status === 'loading') {
    return (
      <p role="status" className="py-3 text-xs text-fg-muted">
        Loading release notes…
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="py-3 text-xs text-fg-muted">
        Couldn&apos;t load release notes. Check your connection and reopen this dialog.
      </p>
    );
  }
  if (state.releases.length === 0) {
    return <p className="py-3 text-xs text-fg-muted">No release notes available.</p>;
  }
  return (
    <ul className="flex max-h-64 flex-col gap-3 overflow-y-auto">
      {state.releases.map((r) => {
        const buckets = parseNotes(r.body);
        return (
          <li key={r.version} className="flex flex-col gap-3 rounded-lg bg-inset px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              {/* Version badge — the prominent, top-of-card element the plain text used to bury. */}
              <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-xs font-semibold text-accent-text">
                {r.version}
              </span>
              {r.date !== '' && (
                <span className="shrink-0 text-[10px] tabular-nums text-fg-muted">
                  {new Date(r.date).toLocaleDateString()}
                </span>
              )}
            </div>
            {buckets.size === 0 ? (
              <p className="text-[13px] text-fg-muted">No description provided.</p>
            ) : (
              CATEGORY_ORDER.filter((c) => (buckets.get(c)?.length ?? 0) > 0).map((c, i) => {
                const items = buckets.get(c) ?? [];
                return (
                  <div key={c} className={i > 0 ? 'border-t border-border-subtle pt-3' : undefined}>
                    <NoteCategorySection category={c} items={items} />
                  </div>
                );
              })
            )}
          </li>
        );
      })}
    </ul>
  );
}
