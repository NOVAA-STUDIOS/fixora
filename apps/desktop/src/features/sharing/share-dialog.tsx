import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@fixora/ui';

import { invoke } from '../../lib/bridge.js';
import { useShareStore } from '../../stores/share-store.js';
import { toast } from '../../stores/toast-store.js';

const BADGE_SNIPPET =
  '[![Fixed by Fixora](https://fixora-opal.vercel.app/badge.svg)](https://fixora-opal.vercel.app)';

const TWEET_TEXT =
  'Just fixed a bug with @FixoraAI ⚡\nAI-powered code repair that actually works.\nTry it free: fixora-opal.vercel.app';

/** Offered after every 5th successful repair (`share-store.ts`), to turn a working fix into a
 * README badge or a tweet. Dismissing is "Maybe Later", taken literally — see the store. */
export function ShareDialog(): React.JSX.Element | null {
  const open = useShareStore((s) => s.open);
  const dismiss = useShareStore((s) => s.dismiss);
  const markShared = useShareStore((s) => s.markShared);

  if (!open) return null;

  const copyBadge = (): void => {
    navigator.clipboard
      .writeText(BADGE_SNIPPET)
      .then(() => {
        toast.success('Badge markdown copied!');
        markShared();
      })
      .catch(() => {
        toast.error("Couldn't copy to clipboard.");
      });
  };

  const tweet = (): void => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(TWEET_TEXT)}`;
    void invoke('system:openExternal', { url });
    markShared();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogTitle className="text-base font-semibold text-fg">Share your fix! 🎉</DialogTitle>
        <DialogDescription className="text-sm text-fg-muted">
          Let people know your code is kept clean with Fixora.
        </DialogDescription>

        <pre className="mt-4 overflow-x-auto rounded-lg border border-border-strong bg-inset px-3 py-2 text-xs text-fg-muted">
          <code>{BADGE_SNIPPET}</code>
        </pre>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Maybe Later
          </Button>
          <Button variant="secondary" size="sm" onClick={copyBadge}>
            Copy Badge
          </Button>
          <Button variant="primary" size="sm" onClick={tweet}>
            Tweet
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
