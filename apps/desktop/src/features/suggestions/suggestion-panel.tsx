import { useEffect, useState } from 'react';

import { toast } from '../../stores/toast-store.js';

import { MailUnavailableDialog } from './mail-unavailable-dialog.js';
import { SuggestionForm } from './suggestion-form.js';
import { SuggestionHistory } from './suggestion-history.js';
import { useSuggestionsStore } from './suggestions-store.js';
import { ThankYouDialog } from './thank-you-dialog.js';

/**
 * The Suggestion System (Sprint F1): a category selector, an auto-resizing message field, and the
 * local history of everything the user has sent — full-width like Settings, since it is not
 * workspace-scoped and needs no project open (feedback about Fixora itself, not about the user's
 * code).
 */
export function SuggestionPanel(): React.JSX.Element {
  const suggestions = useSuggestionsStore((s) => s.suggestions);
  const loaded = useSuggestionsStore((s) => s.loaded);
  const submitting = useSuggestionsStore((s) => s.submitting);
  const error = useSuggestionsStore((s) => s.error);
  const refresh = useSuggestionsStore((s) => s.refresh);
  const submit = useSuggestionsStore((s) => s.submit);
  const remove = useSuggestionsStore((s) => s.remove);
  const clear = useSuggestionsStore((s) => s.clear);
  const exportToFile = useSuggestionsStore((s) => s.exportToFile);
  const share = useSuggestionsStore((s) => s.share);
  const shareViaGmail = useSuggestionsStore((s) => s.shareViaGmail);
  const clearError = useSuggestionsStore((s) => s.clearError);

  const [thankYouOpen, setThankYouOpen] = useState(false);
  const [mailUnavailable, setMailUnavailable] = useState<{
    id: string;
    to: string;
    subject: string;
    body: string;
  } | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSubmit = async (
    category: Parameters<typeof submit>[0],
    message: string,
  ): Promise<boolean> => {
    const ok = await submit(category, message);
    if (ok) setThankYouOpen(true);
    return ok;
  };

  const handleExport = async (): Promise<void> => {
    const path = await exportToFile();
    if (path !== null) {
      toast.success('Suggestions exported', path);
    }
  };

  const handleShare = async (id: string): Promise<void> => {
    const outcome = await share(id);
    // 'opened': deliberately silent — a successful share needs no toast (Sprint F1.4 UX
    // requirement). 'not_found' and 'ipc_error' are ordinary toasts; 'no_mail_client' is the one
    // case that gets a full dialog, because it is the one time the user has no other way to get
    // their suggestion out and needs the recipient/subject/message, plus the Gmail fallback (F1.5).
    if (outcome.status === 'not_found') {
      toast.error('Could not email that suggestion', 'It may have been deleted already.');
    } else if (outcome.status === 'ipc_error') {
      toast.error('Could not email that suggestion', outcome.message);
    } else if (outcome.status === 'no_mail_client') {
      setMailUnavailable({ id, to: outcome.to, subject: outcome.subject, body: outcome.body });
    }
  };

  const handleOpenGmail = async (): Promise<void> => {
    if (mailUnavailable === null) return;
    const outcome = await shareViaGmail(mailUnavailable.id);
    // 'opened': silent — same "no unnecessary toast on success" rule as the mailto path — and the
    // dialog closes, since the user's next step (Gmail, in the browser) is now underway.
    if (outcome.status === 'opened') {
      setMailUnavailable(null);
    } else if (outcome.status === 'browser_failed') {
      // The dialog stays open — Copy Email / Copy Subject / Copy Message are still right there.
      toast.error("Fixora couldn't open Gmail", 'Please copy the email address instead.');
    } else if (outcome.status === 'ipc_error') {
      toast.error("Fixora couldn't open Gmail", outcome.message);
    } else {
      // 'not_found' — the suggestion was deleted between opening this dialog and clicking the
      // button. Same message as the equivalent case on the mailto path.
      toast.error('Could not email that suggestion', 'It may have been deleted already.');
      setMailUnavailable(null);
    }
  };

  return (
    <section
      aria-label="Suggestions"
      className="flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-subtle bg-raised"
    >
      <header className="flex h-11 shrink-0 items-center border-b border-border-subtle px-6">
        <h2 className="text-sm font-semibold text-fg">Suggestions</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-8">
          <p className="rounded-md border border-border-subtle bg-inset px-3 py-2 text-xs leading-relaxed text-fg-muted">
            Suggestions are stored locally on this device and are never sent anywhere automatically.
            Use <strong className="font-medium text-fg-secondary">Email to Fixora</strong> on a
            suggestion below to send it to us by email, or{' '}
            <strong className="font-medium text-fg-secondary">Export JSON</strong> to save a copy
            yourself.
          </p>
          <SuggestionForm
            submitting={submitting}
            serverError={error}
            onDismissServerError={clearError}
            onSubmit={handleSubmit}
          />
          <SuggestionHistory
            suggestions={suggestions}
            loaded={loaded}
            onRemove={(id) => {
              void remove(id);
            }}
            onClear={() => {
              void clear();
            }}
            onExport={() => {
              void handleExport();
            }}
            onShare={(id) => {
              void handleShare(id);
            }}
          />
        </div>
      </div>

      <ThankYouDialog open={thankYouOpen} onOpenChange={setThankYouOpen} />
      <MailUnavailableDialog
        open={mailUnavailable !== null}
        onOpenChange={(open) => {
          if (!open) setMailUnavailable(null);
        }}
        to={mailUnavailable?.to ?? ''}
        subject={mailUnavailable?.subject ?? ''}
        body={mailUnavailable?.body ?? ''}
        onOpenGmail={() => {
          void handleOpenGmail();
        }}
      />
    </section>
  );
}
