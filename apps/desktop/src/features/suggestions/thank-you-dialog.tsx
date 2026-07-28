import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@fixora/ui';

/**
 * Shown once a suggestion is confirmed persisted (Sprint F1). It is a moment of closure, not a form
 * — nothing to fill in, one way out — so it gets a single Close action rather than the
 * Cancel/Confirm pair `ConfirmDialog` uses for a decision.
 */
export function ThankYouDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm text-center">
        <DialogTitle className="text-base font-semibold text-fg">Thanks for the idea!</DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-relaxed text-fg-muted">
          Your suggestion is saved locally and listed below. Nothing was sent anywhere — export it to
          JSON any time you want to share it with us.
        </DialogDescription>
        <Button
          className="mt-6 w-full"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          Done
        </Button>
      </DialogContent>
    </Dialog>
  );
}
