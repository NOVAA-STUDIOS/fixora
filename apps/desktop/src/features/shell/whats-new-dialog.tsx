import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@fixora/ui';
import { useEffect, useState } from 'react';

import { invoke } from '../../lib/bridge.js';

/**
 * The What's New quick action (Sprint F2: Welcome Experience).
 *
 * A short, hand-maintained list of recent highlights — not a live fetch of `CHANGELOG.md` (no
 * Markdown-rendering dependency in this app, and the changelog's full history is more detail than a
 * "here's what's new" glance needs) and not an external link (works with no network connection).
 * Update `HIGHLIGHTS` by hand alongside `CHANGELOG.md`'s `[Unreleased]` section each release.
 *
 * The build version is shown as its own line, separate from the highlights list, rather than as the
 * dialog's description directly above it ("Current build: vX" immediately over a list of items).
 * Several of these highlights (Proceed Mode, the Suggestion System) are unreleased/post-tag work per
 * `PROJECT_STATUS.md`, not part of any tagged version yet — juxtaposing a specific version number
 * with a list implying "this is what that version contains" overclaimed what the running build
 * actually ships (beta audit A1, What's New finding 1).
 */

type Highlight = { title: string; detail: string };

const HIGHLIGHTS: Highlight[] = [
  {
    title: 'Welcome Experience',
    detail:
      'A premium first-run screen: pinnable recent projects, quick actions, and a splash that closes the instant startup finishes — never a manufactured wait.',
  },
  {
    title: 'Suggestion System',
    detail:
      'Send feedback straight from the app — category, message, local history, JSON export, and Email to Fixora with a Gmail fallback when no mail client is configured.',
  },
  {
    title: 'Proceed Mode',
    detail:
      'A second editing pipeline: describe a change in plain language and get a VERIFIED edit proposal, reviewed with the same trust surface as a repair.',
  },
  {
    title: 'Reliability hardening',
    detail:
      'A full audit pass across Repair and Proceed fixed retry/cancel edge cases and added a write-verification safety net that catches a bad write before it is ever reported as success.',
  },
];

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
  const [version, setVersion] = useState<string | null>(null);
  const [changelog, setChangelog] = useState<ChangelogState>(
    changelogCache !== null ? { status: 'ready', releases: changelogCache } : { status: 'loading' },
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void invoke('system:getAppInfo', {}).then((r) => {
      if (!cancelled && r.ok) setVersion(r.value.version);
    });
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
          <DialogDescription className="text-sm text-fg-secondary">
            Recent highlights from across Fixora.
          </DialogDescription>
        </div>
        <ul className="flex flex-col gap-3">
          {HIGHLIGHTS.map((item) => (
            <li key={item.title} className="flex flex-col gap-0.5 rounded-lg bg-inset px-3 py-2.5">
              <span className="text-sm font-medium text-fg">{item.title}</span>
              <span className="text-xs leading-relaxed text-fg-muted">{item.detail}</span>
            </li>
          ))}
        </ul>
        {/* A separate, secondary line — not positioned as "this version contains the list above" —
            since several highlights are unreleased/post-tag work, not part of any tagged version. */}
        {version !== null && (
          <p className="pt-3 text-[11px] tabular-nums text-fg-muted">Running v{version}</p>
        )}

        <div className="mt-4 flex flex-col gap-1 border-t border-border-subtle pt-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Release notes
          </span>
          <ChangelogBody state={changelog} />
        </div>
      </DialogContent>
    </Dialog>
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
      {state.releases.map((r) => (
        <li key={r.version} className="flex flex-col gap-1 rounded-lg bg-inset px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-fg">{r.version}</span>
            {r.date !== '' && (
              <span className="shrink-0 text-[10px] tabular-nums text-fg-muted">
                {new Date(r.date).toLocaleDateString()}
              </span>
            )}
          </div>
          {/* No Markdown-rendering dependency in this app (see HIGHLIGHTS' own note above) — a
              GitHub release body is rendered line-by-line rather than pulling one in for this. */}
          <div className="whitespace-pre-line text-xs leading-relaxed text-fg-muted">
            {r.body.trim() === '' ? 'No description provided.' : r.body}
          </div>
        </li>
      ))}
    </ul>
  );
}
