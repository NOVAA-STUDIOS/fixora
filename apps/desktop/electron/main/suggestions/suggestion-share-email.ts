import { SUGGESTION_CATEGORY_LABELS, type SuggestionCategory } from '@fixora/shared-types';

/**
 * The share-email formatter (Sprint F1.1): pure, synchronous, no I/O — like the validator, it is
 * testable without a database or Electron. It knows nothing about SQLite, IPC, or `shell`; it turns
 * a suggestion plus environment facts into the exact subject/body text `suggestions:share` sends to
 * the mail client.
 */

export type ShareEmailInput = {
  category: SuggestionCategory;
  message: string;
  appVersion: string;
  /** Node's `process.platform`, e.g. 'win32' | 'darwin' | 'linux'. */
  platform: string;
  /** The open workspace's name, or null if none is open — looked up fresh per request, unlike
   *  `appVersion`/`platform` which are static for the process lifetime. */
  workspaceName: string | null;
  /** An already-formatted timestamp (e.g. `new Date().toISOString()`), supplied by the caller so
   *  this function stays pure/deterministic and does not read the clock itself. */
  timestamp: string;
};

export type ShareEmail = {
  subject: string;
  body: string;
};

const OS_LABELS: Record<string, string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
};

/** A readable OS name for an unrecognised platform falls back to the raw value rather than hiding it. */
export function osLabel(platform: string): string {
  return OS_LABELS[platform] ?? platform;
}

export function buildShareEmail(input: ShareEmailInput): ShareEmail {
  const categoryLabel = SUGGESTION_CATEGORY_LABELS[input.category];
  return {
    subject: `Fixora Suggestion - ${categoryLabel}`,
    body: [
      `Category: ${categoryLabel}`,
      '',
      'Suggestion:',
      input.message,
      '',
      `Fixora version: ${input.appVersion}`,
      `Operating System: ${osLabel(input.platform)}`,
      `Workspace: ${input.workspaceName ?? 'None'}`,
      `Timestamp: ${input.timestamp}`,
    ].join('\n'),
  };
}
