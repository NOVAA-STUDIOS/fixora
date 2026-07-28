import { z } from 'zod';

/**
 * Sprint F1 — the Suggestion System. A user-submitted idea, bug note, or piece of feedback about
 * Fixora itself (not about their project) — categorized, timestamped, and kept locally so they can
 * review or export what they have sent. There is no server on this path (Beta is BYOK-first,
 * offline-first): a suggestion lives in the local SQLite database next to everything else Fixora
 * already keeps about the user's session, and "export to JSON" is how it leaves the machine, on the
 * user's terms, never automatically.
 */

export const SuggestionCategorySchema = z.enum(['feature', 'bug', 'improvement', 'other']);
export type SuggestionCategory = z.infer<typeof SuggestionCategorySchema>;

/**
 * The one human-readable label per category, shared by the renderer's form/history UI and by the
 * main process's share-email formatter (Sprint F1.1) — so "Feature request" in the app and
 * "Fixora Suggestion - Feature request" in the email a user sends never drift apart.
 */
export const SUGGESTION_CATEGORY_LABELS: Record<SuggestionCategory, string> = {
  feature: 'Feature request',
  bug: 'Bug report',
  improvement: 'Improvement',
  other: 'Other',
};

export const SUGGESTION_MESSAGE_MIN_LENGTH = 10;
export const SUGGESTION_MESSAGE_MAX_LENGTH = 2000;

export const SuggestionSchema = z.object({
  id: z.string().min(1),
  category: SuggestionCategorySchema,
  message: z.string().min(1),
  createdAt: z.number().int(),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

export const SubmitSuggestionRequestSchema = z.object({
  category: SuggestionCategorySchema,
  message: z.string(),
});
export type SubmitSuggestionRequest = z.infer<typeof SubmitSuggestionRequestSchema>;

/**
 * The outcome of `suggestions:share` (Sprint F1.1; the mail-client-detection hardening is F1.4).
 * `no_mail_client` carries the composed `to`/`subject`/`body` so the renderer's failure UI can offer
 * "Copy Email Address", "Copy Subject", "Copy Message", and the Gmail web fallback (Sprint F1.5) —
 * the one time this channel's response needs more than a status, because there is otherwise no way
 * for the user to get their suggestion out any other way.
 */
export const ShareSuggestionResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('opened') }),
  z.object({ status: z.literal('not_found') }),
  z.object({
    status: z.literal('no_mail_client'),
    to: z.string(),
    subject: z.string(),
    body: z.string(),
  }),
]);
export type ShareSuggestionResponse = z.infer<typeof ShareSuggestionResponseSchema>;

/**
 * The outcome of `suggestions:shareViaGmail` (Sprint F1.5) — the user explicitly chose "Open Gmail"
 * from the no-mail-client dialog. `browser_failed` is the one anticipated failure: `shell.openExternal`
 * itself could not launch a browser for the URL.
 */
export const ShareViaGmailResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('opened') }),
  z.object({ status: z.literal('not_found') }),
  z.object({ status: z.literal('browser_failed') }),
]);
export type ShareViaGmailResponse = z.infer<typeof ShareViaGmailResponseSchema>;
