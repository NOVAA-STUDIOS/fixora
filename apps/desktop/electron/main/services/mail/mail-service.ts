import { shell } from 'electron';

import { buildGmailComposeUrl, type GmailComposeInput } from './gmail-compose-url.js';
import { GmailFallbackError, MailUnavailableError } from './mail-errors.js';
import { hasMailtoHandler } from './mail-handler-detection.js';
import { validateMail } from './mail-validator.js';
import { buildMailtoUrl, type MailtoInput } from './mailto-url.js';

/**
 * The one, reusable way anything in Fixora opens a `mailto:` link, plus (Sprint F1.5) the one way it
 * opens the Gmail web-compose fallback when a local mail client is unavailable. Nothing else in the
 * app is allowed to call `shell.openExternal` with either kind of URL directly — every caller goes
 * through `sendMail`/`openGmailFallback`, so validation, encoding, detection, the scheme guards, and
 * logging all happen in exactly one place. (`security/navigation-guard.ts`'s `openExternal` is a
 * *different* function, for a fixed allowlist of `https:` docs/marketing hosts, and remains
 * separate — see its own doc comment and `openGmailFallback`'s, below.)
 *
 * BUG-F1-EMAIL-001 established, with real (non-mocked) runtime evidence, that `shell.openExternal`
 * resolving is not proof that anything opened: its Promise contract is "the OS was asked", not "an
 * application launched", and a machine with no default mail client configured — the exact condition
 * originally reported — hits that gap with no rejection to catch. `sendMail` closes it by checking,
 * per platform, whether a handler is even registered *before* ever calling `shell.openExternal`:
 *
 *  - **Windows**: `HKEY_CLASSES_ROOT\mailto\shell\open\command` via `reg.exe` (exact, reliable).
 *  - **macOS**: the LaunchServices database via `defaults` (heuristic over an undocumented format —
 *    documented in `mail-handler-detection.ts` and `docs/features/mail-service.md`).
 *  - **Linux**: `xdg-mime query default x-scheme-handler/mailto`, falling back to checking whether
 *    `xdg-email` is on `PATH` (weaker signal — documented as a known limitation).
 *
 * A platform this file has no check for is not blocked on one it cannot perform — it falls through
 * to `shell.openExternal`'s own resolve/reject, the same as before this fix existed.
 *
 * Sprint F1.5 (Gmail fallback): when `sendMail` throws `MailUnavailableError`, the caller may offer
 * the user a one-click way to compose the same email in Gmail's web UI instead — `openGmailFallback`
 * is that path. It does not attempt its own "is a browser installed" pre-check the way `sendMail`
 * does for mail clients (a default web browser is present on essentially every real desktop, and no
 * such check was asked for); it relies on `shell.openExternal`'s own resolve/reject, same as before
 * BUG-F1-EMAIL-001's fix existed for mailto — a materially safe simplification given how much more
 * reliably browsers are actually present.
 *
 * Every lifecycle step logs via `console.warn` — never `console.log`, which this codebase's lint
 * config forbids outright (main-process logs are read from the user's own machine; `warn`/`error`
 * are the only levels allowed, so there is no way to accidentally ship a noisy debug trace).
 */

export type MailResult = { url: string };

export function createMailService(deps: { platform?: string } = {}) {
  const platform = deps.platform ?? process.platform;

  return {
    async sendMail(input: MailtoInput): Promise<MailResult> {
      const startedAt = Date.now();

      const validation = validateMail(input);
      console.warn('[MailService] validation', { platform, ok: validation.ok });
      if (!validation.ok) {
        throw new Error(validation.error);
      }

      const url = buildMailtoUrl(input);
      // Belt-and-braces: `url` is always `mailto:${to}?...` by construction above, so this can only
      // fire if a future refactor changes that — but "only mailto: is ever allowed to reach
      // shell.openExternal" is a stated security invariant, so it is asserted here, not assumed.
      const parsed = new URL(url);
      if (parsed.protocol !== 'mailto:') {
        throw new Error(`Refusing to open a non-mailto URL scheme: ${parsed.protocol}`);
      }
      console.warn('[MailService] mailto URL generated', { platform, url });

      const hasHandler = await hasMailtoHandler(platform);
      console.warn('[MailService] handler detection', { platform, hasHandler });
      if (!hasHandler) {
        console.warn('[MailService] no handler registered — refusing before shell.openExternal', {
          platform,
          durationMs: Date.now() - startedAt,
        });
        throw new MailUnavailableError('No default mail application is configured.');
      }

      try {
        await shell.openExternal(url);
        console.warn('[MailService] shell.openExternal resolved', {
          platform,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        console.error('[MailService] shell.openExternal rejected', {
          platform,
          message: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startedAt,
        });
        throw new MailUnavailableError('No default mail application is configured.');
      }

      return { url };
    },

    /**
     * Opens Gmail's web compose UI, pre-filled, in the user's default browser — the fallback for
     * when `sendMail` threw `MailUnavailableError`. Only ever opens `https://mail.google.com/…`;
     * every other scheme or host is refused, the same defense-in-depth discipline `sendMail` applies
     * to `mailto:`.
     */
    async openGmailFallback(input: GmailComposeInput): Promise<MailResult> {
      const startedAt = Date.now();

      const validation = validateMail(input);
      console.warn('[MailService] gmail fallback validation', { platform, ok: validation.ok });
      if (!validation.ok) {
        throw new Error(validation.error);
      }

      const url = buildGmailComposeUrl(input);
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'mail.google.com') {
        throw new Error(`Refusing to open a non-Gmail fallback URL: ${parsed.origin}`);
      }
      console.warn('[MailService] gmail fallback URL generated', { platform, url });

      try {
        await shell.openExternal(url);
        console.warn('[MailService] gmail fallback shell.openExternal resolved', {
          platform,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        console.error('[MailService] gmail fallback shell.openExternal rejected', {
          platform,
          message: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startedAt,
        });
        throw new GmailFallbackError(
          "Fixora couldn't open Gmail. Please copy the email address instead.",
        );
      }

      return { url };
    },
  };
}

export type MailService = ReturnType<typeof createMailService>;
