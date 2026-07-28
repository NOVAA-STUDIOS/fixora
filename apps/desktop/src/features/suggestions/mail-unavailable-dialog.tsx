import { Button, CopyIcon, Dialog, DialogContent, DialogDescription, DialogTitle } from '@fixora/ui';

import { copyToClipboard } from '../../lib/clipboard.js';

/**
 * Shown when `MailService` could not confirm a mail client is available (Sprint F1.4). Sprint F1.5
 * added the Gmail web-compose fallback and Copy Message, since Copy Email / Copy Subject alone
 * still left the user typing the whole suggestion out by hand if they had no local mail app at all.
 */
export function MailUnavailableDialog({
  open,
  onOpenChange,
  to,
  subject,
  body,
  onOpenGmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  to: string;
  subject: string;
  body: string;
  onOpenGmail: () => void;
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle className="text-base font-semibold text-fg">
          Couldn't open your default mail application
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-relaxed text-fg-secondary">
          Fixora couldn't find a configured mail application.
          <br />
          <br />
          You can either open Gmail in your browser or copy the email details.
        </DialogDescription>

        <div className="mt-4 flex flex-col gap-2">
          <Button type="button" onClick={onOpenGmail}>
            Open Gmail
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                void copyToClipboard(to, { label: 'Email address copied' });
              }}
            >
              <CopyIcon className="size-4" />
              Copy Email Address
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                void copyToClipboard(subject, { label: 'Subject copied' });
              }}
            >
              <CopyIcon className="size-4" />
              Copy Subject
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                void copyToClipboard(body, { label: 'Message copied' });
              }}
            >
              <CopyIcon className="size-4" />
              Copy Message
            </Button>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          className="mt-4 w-full"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          Cancel
        </Button>
      </DialogContent>
    </Dialog>
  );
}
