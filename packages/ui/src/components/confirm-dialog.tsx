import { Button } from './button.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog.js';

/**
 * A destructive-action confirmation.
 *
 * `window.confirm` was what the app used, and it is an immediate tell: an OS-chrome alert box with
 * the wrong typeface, the wrong buttons and the app's name in the title bar, dropped into the
 * middle of a designed product. It also blocks the renderer thread outright.
 *
 * This is the same contract in the app's own surface — and it says what will happen in the button,
 * not just in the prose. "Clear all" is a better last thing to read than "OK", because the label of
 * the button you are about to press is the thing people actually read before pressing it.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = true,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0">
        <div className="flex flex-col gap-2 px-5 pt-5 pb-4">
          <DialogTitle className="text-base font-semibold text-fg">{title}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-fg-secondary">
            {description}
          </DialogDescription>
        </div>
        {/* The action bar sits on its own surface so the buttons read as the decision, separate
            from the explanation above them. */}
        <div className="flex items-center justify-end gap-2 border-t border-border-subtle bg-inset px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            size="sm"
            // The destructive action is never the default focus target — a stray Enter on a
            // just-opened dialog must not be able to clear someone's history.
            autoFocus={false}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
