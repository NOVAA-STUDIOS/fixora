import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, cn } from '@fixora/ui';
import { useState } from 'react';

import { invoke } from '../../lib/bridge.js';
import { supabase } from '../../lib/supabase.js';
import { toast } from '../../stores/toast-store.js';
import { useAuthStore } from '../auth/auth-store.js';

import { useFeedbackStore } from './feedback-store.js';

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * The feedback prompt, shown once after the product has proved itself (see `feedback-store.ts`).
 *
 * The publish checkbox is the part worth being careful about. Everything typed here is written to
 * a table the marketing site reads from, so consent is asked for explicitly, defaults to OFF, and
 * says where the text would appear. Feedback given in a private dialog and quietly published is a
 * breach of the user's expectation even when the review is glowing.
 */
export function FeedbackDialog(): React.JSX.Element | null {
  const open = useFeedbackStore((s) => s.open);
  const dismiss = useFeedbackStore((s) => s.dismiss);
  const markSubmitted = useFeedbackStore((s) => s.markSubmitted);
  const user = useAuthStore((s) => s.user);

  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [sending, setSending] = useState(false);

  if (!open) return null;

  const submit = async (): Promise<void> => {
    if (rating === 0 || sending) return;
    setSending(true);

    // Version is a nice-to-have for triage, never a reason to fail the submission.
    let appVersion: string | null = null;
    const info = await invoke('system:getAppInfo', {});
    if (info.ok) appVersion = info.value.version;

    const trimmed = comment.trim();
    const { error } = await supabase.from('feedback').insert({
      rating,
      comment: trimmed === '' ? null : trimmed,
      app_version: appVersion,
      user_id: user?.id ?? null,
      // Only ever true when the user ticked the box AND actually wrote something — publishing an
      // empty card helps nobody.
      is_public: isPublic && trimmed !== '',
    });

    setSending(false);
    if (error) {
      toast.error("Couldn't send feedback. Try again.", error.message);
      return;
    }
    markSubmitted();
    toast.success('Thanks for your feedback! 🎉');
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // Closing by any route — Escape, the overlay, the button — is a "maybe later", never a
        // silent no-op that leaves the prompt to reappear on the next repair.
        if (!next) dismiss();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogTitle className="text-base font-semibold text-fg">
          How&apos;s Fixora working for you?
        </DialogTitle>
        <DialogDescription className="text-sm text-fg-muted">
          Your rating helps us decide what to build next.
        </DialogDescription>

        <div className="mt-4 flex justify-center gap-1" role="radiogroup" aria-label="Rating">
          {STARS.map((star) => (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={rating === star}
              aria-label={`${String(star)} star${star === 1 ? '' : 's'}`}
              onMouseEnter={() => {
                setHovered(star);
              }}
              onMouseLeave={() => {
                setHovered(0);
              }}
              onClick={() => {
                setRating(star);
              }}
              className={cn(
                'rounded px-1 text-3xl leading-none transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline',
                (hovered === 0 ? rating : hovered) >= star ? 'text-warn' : 'text-border-strong',
              )}
            >
              ★
            </button>
          ))}
        </div>

        <textarea
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
          }}
          rows={3}
          placeholder="Tell us more… (optional)"
          className="mt-4 w-full resize-none rounded-lg border border-border-strong bg-inset px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline"
        />

        {comment.trim() !== '' && (
          <label className="mt-3 flex items-start gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => {
                setIsPublic(e.target.checked);
              }}
              className="mt-0.5 shrink-0"
            />
            <span>
              Show this on the Fixora website. Your rating and comment would be public; your name
              and email never are.
            </span>
          </label>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Maybe Later
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={rating === 0 || sending}
            title={rating === 0 ? 'Pick a rating first' : undefined}
            onClick={() => void submit()}
          >
            {sending ? 'Sending…' : 'Submit Feedback'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
