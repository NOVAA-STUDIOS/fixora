import { writeFileSync } from 'node:fs';

import { UserFacingError } from '@fixora/shared-types';
import { BrowserWindow, dialog } from 'electron';

import { GmailFallbackError, MailUnavailableError } from '../../services/mail/mail-errors.js';
import type { MailService } from '../../services/mail/mail-service.js';
import type { WorkspaceService } from '../../services/workspace-service.js';
import type { SuggestionService } from '../../suggestions/suggestion-service.js';
import { registerHandler } from '../router.js';

/**
 * Fixora's own feedback address. This is the one place the Suggestion System decides *who* a
 * shared suggestion goes to — `MailService` itself is fully generic and takes `to` as a parameter,
 * so it has no built-in recipient at all (Sprint F1.4, "MailService used everywhere, no duplicate
 * mail-opening logic").
 */
const SUPPORT_ADDRESS = 'novaa.support.team@gmail.com';

/**
 * Suggestion System handlers (Sprint F1, F1.1, F1.4, F1.5). Every channel routes straight through
 * the service — validation, persistence, and share-email composition all live there, so this file
 * only shapes requests/responses and owns the two pieces of Electron API the service cannot: the
 * native save dialog for export, and (via `MailService`) opening the default mail client or the
 * Gmail web fallback for share.
 */
export function registerSuggestionHandlers(
  service: SuggestionService,
  mailService: MailService,
  workspaceService: WorkspaceService,
): void {
  registerHandler('suggestions:submit', ({ category, message }) => ({
    suggestion: service.submit({ category, message }),
  }));

  registerHandler('suggestions:list', () => ({ suggestions: service.list() }));

  registerHandler('suggestions:remove', ({ id }) => {
    service.remove(id);
    return { suggestions: service.list() };
  });

  registerHandler('suggestions:clear', () => {
    service.clear();
    return { suggestions: service.list() };
  });

  // The user picks the destination; Fixora writes the file and never transmits it anywhere. A
  // cancelled dialog is a normal outcome (path: null), not an error.
  registerHandler('suggestions:export', async (_req, { window }) => {
    const owner = window ?? BrowserWindow.getFocusedWindow() ?? undefined;
    const result = await dialog.showSaveDialog(owner as BrowserWindow, {
      title: 'Export suggestions',
      defaultPath: `fixora-suggestions-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || result.filePath === '') {
      return { path: null };
    }
    try {
      writeFileSync(result.filePath, service.exportToJson(), 'utf8');
    } catch {
      throw new UserFacingError(
        'Fixora could not write the export file. Check that the location is writable and try again.',
        { code: 'export_write_failed', action: { type: 'retry', label: 'Try again' } },
      );
    }
    return { path: result.filePath };
  });

  // `not_found` means the suggestion no longer exists (e.g. deleted from another window between
  // the click and this call) — not a failure to reach the mail client. `no_mail_client` carries the
  // composed to/subject/body back so the renderer can offer Copy Email / Copy Subject / Copy
  // Message and the Gmail fallback (F1.5) — the one time this channel needs more than a status,
  // because otherwise the user has no other way to get their suggestion out. A validation failure
  // inside MailService (should not happen — the subject/body here are our own generated text, never
  // raw user input passed straight through) is treated as a genuine bug and allowed to propagate,
  // not folded into "no mail client".
  registerHandler('suggestions:share', async ({ id }) => {
    const email = service.buildShareEmail(id, {
      workspaceName: workspaceService.getCurrent()?.name ?? null,
    });
    if (email === null) return { status: 'not_found' as const };
    try {
      await mailService.sendMail({ to: SUPPORT_ADDRESS, subject: email.subject, body: email.body });
      return { status: 'opened' as const };
    } catch (error) {
      if (error instanceof MailUnavailableError) {
        return {
          status: 'no_mail_client' as const,
          to: SUPPORT_ADDRESS,
          subject: email.subject,
          body: email.body,
        };
      }
      throw error;
    }
  });

  // Sprint F1.5: the user explicitly chose "Open Gmail" from the no-mail-client dialog. Re-derives
  // to/subject/body from the suggestion id itself — same trust rule as 'suggestions:share', never
  // from a renderer-supplied value. `browser_failed` is the one anticipated failure.
  registerHandler('suggestions:shareViaGmail', async ({ id }) => {
    const email = service.buildShareEmail(id, {
      workspaceName: workspaceService.getCurrent()?.name ?? null,
    });
    if (email === null) return { status: 'not_found' as const };
    try {
      await mailService.openGmailFallback({
        to: SUPPORT_ADDRESS,
        subject: email.subject,
        body: email.body,
      });
      return { status: 'opened' as const };
    } catch (error) {
      if (error instanceof GmailFallbackError) return { status: 'browser_failed' as const };
      throw error;
    }
  });
}
