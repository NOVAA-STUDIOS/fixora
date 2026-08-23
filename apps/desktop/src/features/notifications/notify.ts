import { invoke } from '../../lib/bridge.js';
import { toast, type ToastTone } from '../../stores/toast-store.js';

/**
 * One event, both surfaces.
 *
 * The in-app toast always fires — it is the record of what happened for a user who is looking. The
 * OS notification is requested only for events that matter when they are NOT looking, and main
 * suppresses it while the window is focused (`notifications.handlers.ts`), so a user at the screen
 * never gets told the same thing twice.
 *
 * `alsoNotifyOs` is opt-in per call rather than a property of the tone: whether an event deserves
 * to interrupt someone in another application is a judgement about that event, not about whether
 * it was a success or a failure.
 */
export function notify(
  tone: ToastTone,
  title: string,
  description?: string,
  options?: { alsoNotifyOs?: boolean; urgency?: 'normal' | 'critical' },
): void {
  toast[tone](title, description);

  if (options?.alsoNotifyOs !== true) return;
  // Fire-and-forget: a notification that could not be shown must never fail the action that
  // triggered it, and the toast has already reported the outcome either way.
  void invoke('notifications:show', {
    title,
    body: description ?? '',
    ...(options.urgency !== undefined && { urgency: options.urgency }),
  });
}
