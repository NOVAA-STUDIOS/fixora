import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Renderer-side integration test: the real store, the real form, the real history list and the
 * real thank-you dialog, mounted together with only the IPC bridge mocked — the same boundary
 * `suggestions-handlers.test.ts` covers from the main-process side. This is what proves the pieces
 * actually wire together (submit → thank-you dialog → history refresh), not just that each works
 * in isolation.
 */

const invoke = vi.hoisted(() => vi.fn());

vi.mock('../../lib/bridge.js', () => ({ invoke, subscribe: () => () => undefined }));

const { SuggestionPanel } = await import('./suggestion-panel.js');
const { useSuggestionsStore } = await import('./suggestions-store.js');
const { useToastStore } = await import('../../stores/toast-store.js');

const stored = {
  id: 's1',
  category: 'feature' as const,
  message: 'a perfectly good suggestion',
  createdAt: Date.now(),
};

beforeEach(() => {
  vi.clearAllMocks();
  useSuggestionsStore.setState({ suggestions: [], loaded: false, submitting: false, error: null });
  useToastStore.setState({ toasts: [] });
});

describe('SuggestionPanel (integration)', () => {
  it('loads existing suggestions on mount', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { suggestions: [stored] } });
    render(<SuggestionPanel />);
    expect(await screen.findByText('a perfectly good suggestion')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('suggestions:list', {});
  });

  it('submitting a valid suggestion shows the thank-you dialog and adds it to history', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { suggestions: [] } }); // initial refresh
    render(<SuggestionPanel />);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('suggestions:list', {});
    });

    invoke.mockResolvedValueOnce({ ok: true, value: { suggestion: stored } }); // submit
    fireEvent.change(screen.getByLabelText("What's on your mind?"), {
      target: { value: 'a perfectly good suggestion' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send suggestion/i }));

    expect(await screen.findByText('Thanks for the idea!')).toBeTruthy();
    // The history list updates from the store's optimistic prepend, without a second list call —
    // and the form itself cleared, so this one match is the history row, not a leftover form value.
    expect(screen.getByText('a perfectly good suggestion')).toBeTruthy();
    expect(screen.getByLabelText("What's on your mind?")).toHaveValue('');
  });

  it('a rejected submission shows the server error and never opens the thank-you dialog', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { suggestions: [] } });
    render(<SuggestionPanel />);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('suggestions:list', {});
    });

    invoke.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'IPC_HANDLER_FAILED',
        message: 'Your suggestion is too short.',
        action: { type: 'none', label: 'Dismiss' },
      },
    });
    fireEvent.change(screen.getByLabelText("What's on your mind?"), {
      target: { value: 'a perfectly good suggestion' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send suggestion/i }));

    expect(await screen.findByText('Your suggestion is too short.')).toBeTruthy();
    expect(screen.queryByText('Thanks for the idea!')).toBeNull();
  });

  it('shows the local-storage note and lets a stored suggestion be emailed to Fixora', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { suggestions: [stored] } });
    render(<SuggestionPanel />);
    await screen.findByText('a perfectly good suggestion');

    expect(screen.getByText(/stored locally on this device/i)).toBeTruthy();

    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'opened' } });
    fireEvent.click(screen.getByRole('button', { name: /email to fixora/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('suggestions:share', { id: 's1' });
    });
    // A successful share is quiet by design (no confirmation needed for a non-destructive action)
    // — but that silence must never mask a failure. Confirming no error toast appeared is what
    // makes this a real success-path test, not just "the call happened".
    expect(useToastStore.getState().toasts).toEqual([]);
    expect(screen.queryByText(/couldn't open your default mail application/i)).toBeNull();
  });

  it('shows an error toast when emailing a suggestion that no longer exists', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { suggestions: [stored] } });
    render(<SuggestionPanel />);
    await screen.findByText('a perfectly good suggestion');

    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'not_found' } });
    fireEvent.click(screen.getByRole('button', { name: /email to fixora/i }));

    await waitFor(() => {
      expect(
        useToastStore
          .getState()
          .toasts.some(
            (t) => t.title === 'Could not email that suggestion' && t.description === 'It may have been deleted already.',
          ),
      ).toBe(true);
    });
  });

  it('shows an error toast (real message, never a guess) when the IPC call fails unexpectedly', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { suggestions: [stored] } });
    render(<SuggestionPanel />);
    await screen.findByText('a perfectly good suggestion');

    invoke.mockResolvedValueOnce({
      ok: false,
      error: { code: 'IPC_HANDLER_FAILED', message: 'Something unexpected happened.', action: { type: 'none', label: '' } },
    });
    fireEvent.click(screen.getByRole('button', { name: /email to fixora/i }));

    await waitFor(() => {
      expect(
        useToastStore
          .getState()
          .toasts.some(
            (t) => t.title === 'Could not email that suggestion' && t.description === 'Something unexpected happened.',
          ),
      ).toBe(true);
    });
  });

  const noMailClientResponse = {
    status: 'no_mail_client' as const,
    to: 'novaa.support.team@gmail.com',
    subject: 'Fixora Suggestion - Feature request',
    body: 'Category: Feature request\n\nSuggestion:\na perfectly good suggestion',
  };

  async function openMailUnavailableDialog(): Promise<void> {
    invoke.mockResolvedValueOnce({ ok: true, value: { suggestions: [stored] } });
    render(<SuggestionPanel />);
    await screen.findByText('a perfectly good suggestion');

    invoke.mockResolvedValueOnce({ ok: true, value: noMailClientResponse });
    fireEvent.click(screen.getByRole('button', { name: /email to fixora/i }));
    await screen.findByText("Couldn't open your default mail application");
  }

  /**
   * BUG-F1-EMAIL-001 / Sprint F1.4 (MailService). Clicking "Email to Fixora" used to do nothing
   * visible at all when main failed to open a mail client. Now this is its own status
   * (`no_mail_client`) and opens a dialog — not a toast — with the exact required copy, since the
   * user has no other way to get their suggestion out: Open Gmail, Copy Email Address, Copy
   * Subject, Copy Message, and Cancel (Sprint F1.5).
   */
  it('opens the MailUnavailableDialog with the exact required title/message/buttons when MailService reports no mail client', async () => {
    await openMailUnavailableDialog();

    expect(
      screen.getByText(/Fixora couldn't find a configured mail application/i),
    ).toBeTruthy();
    expect(
      screen.getByText(/open Gmail in your browser or copy the email details/i),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /^open gmail$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /copy email address/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /copy subject/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /copy message/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeTruthy();
    // Not a toast — this is a dialog, since a toast alone cannot hold this many actions plus text.
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('Copy Email Address copies the recipient address to the clipboard', async () => {
    await openMailUnavailableDialog();
    invoke.mockResolvedValueOnce({ ok: true, value: { copied: true } });
    fireEvent.click(screen.getByRole('button', { name: /copy email address/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('system:copyToClipboard', {
        text: 'novaa.support.team@gmail.com',
      });
    });
  });

  it('Copy Subject copies the composed subject to the clipboard', async () => {
    await openMailUnavailableDialog();
    invoke.mockResolvedValueOnce({ ok: true, value: { copied: true } });
    fireEvent.click(screen.getByRole('button', { name: /copy subject/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('system:copyToClipboard', {
        text: 'Fixora Suggestion - Feature request',
      });
    });
  });

  it('Copy Message copies the composed body to the clipboard', async () => {
    await openMailUnavailableDialog();
    invoke.mockResolvedValueOnce({ ok: true, value: { copied: true } });
    fireEvent.click(screen.getByRole('button', { name: /copy message/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('system:copyToClipboard', {
        text: noMailClientResponse.body,
      });
    });
  });

  it('Cancel closes the dialog without calling anything', async () => {
    await openMailUnavailableDialog();
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    await waitFor(() => {
      expect(
        screen.queryByText("Couldn't open your default mail application"),
      ).toBeNull();
    });
    expect(invoke).not.toHaveBeenCalledWith(
      'suggestions:shareViaGmail',
      expect.anything(),
    );
  });

  /**
   * Sprint F1.5: choosing "Open Gmail" from the dialog. A successful launch is silent — same "no
   * unnecessary toast" rule as the mailto path — and the dialog closes since the next step is now
   * happening in the browser.
   */
  it('Open Gmail launches the Gmail compose fallback and closes the dialog on success, with no toast', async () => {
    await openMailUnavailableDialog();
    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'opened' } });
    fireEvent.click(screen.getByRole('button', { name: /^open gmail$/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('suggestions:shareViaGmail', { id: 's1' });
    });
    await waitFor(() => {
      expect(
        screen.queryByText("Couldn't open your default mail application"),
      ).toBeNull();
    });
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  /**
   * Browser launch failure: the dialog stays open (Copy actions are still right there) and shows
   * the exact required message.
   */
  it('shows the exact required message when the Gmail browser launch fails, and keeps the dialog open', async () => {
    await openMailUnavailableDialog();
    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'browser_failed' } });
    fireEvent.click(screen.getByRole('button', { name: /^open gmail$/i }));

    await waitFor(() => {
      expect(
        useToastStore
          .getState()
          .toasts.some(
            (t) =>
              t.title === "Fixora couldn't open Gmail" &&
              t.description === 'Please copy the email address instead.',
          ),
      ).toBe(true);
    });
    // Still open — the user can still copy the details manually.
    expect(screen.getByText("Couldn't open your default mail application")).toBeTruthy();
  });
});
