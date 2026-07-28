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

export function WhatsNewDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void invoke('system:getAppInfo', {}).then((r) => {
      if (!cancelled && r.ok) setVersion(r.value.version);
    });
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
      </DialogContent>
    </Dialog>
  );
}
