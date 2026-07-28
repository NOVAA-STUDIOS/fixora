import { describe, expect, it } from 'vitest';

import {
  buildShareEmail,
  osLabel,
} from '../electron/main/suggestions/suggestion-share-email.js';

/**
 * The share-email formatter is pure, so every rule is directly testable: the exact subject
 * template, that all four required fields (category, suggestion, version, OS) land in the body,
 * and the OS label mapping for every platform Fixora ships on plus an unrecognised one.
 */
describe('buildShareEmail', () => {
  it('formats the subject as "Fixora Suggestion - <Category>" using the human category label', () => {
    const email = buildShareEmail({
      category: 'improvement',
      message: 'Faster startup please',
      appVersion: '1.0.0',
      platform: 'win32',
      workspaceName: null,
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(email.subject).toBe('Fixora Suggestion - Improvement');
  });

  it('includes category, the suggestion text, the app version, and the OS in the body', () => {
    const email = buildShareEmail({
      category: 'bug',
      message: 'Crashes when I open a 10k-file repo',
      appVersion: '2.3.1',
      platform: 'linux',
      workspaceName: null,
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(email.body).toContain('Category: Bug report');
    expect(email.body).toContain('Crashes when I open a 10k-file repo');
    expect(email.body).toContain('Fixora version: 2.3.1');
    expect(email.body).toContain('Operating System: Linux');
  });

  it('uses the exact submitted message verbatim, not a truncated or re-escaped version', () => {
    const message = 'Line one\nLine two with "quotes" and an & ampersand';
    const email = buildShareEmail({
      category: 'other',
      message,
      appVersion: '1.0.0',
      platform: 'darwin',
      workspaceName: null,
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(email.body).toContain(message);
  });

  it('includes the workspace name in the body when one is open', () => {
    const email = buildShareEmail({
      category: 'other',
      message: 'A suggestion with a workspace open',
      appVersion: '1.0.0',
      platform: 'win32',
      workspaceName: 'my-project',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(email.body).toContain('Workspace: my-project');
  });

  it('writes exactly "Workspace: None" when no workspace is open', () => {
    const email = buildShareEmail({
      category: 'other',
      message: 'A suggestion with no workspace open',
      appVersion: '1.0.0',
      platform: 'win32',
      workspaceName: null,
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(email.body).toContain('Workspace: None');
  });

  it('includes the supplied timestamp in the body verbatim', () => {
    const email = buildShareEmail({
      category: 'other',
      message: 'A suggestion with a timestamp',
      appVersion: '1.0.0',
      platform: 'win32',
      workspaceName: null,
      timestamp: '2026-03-14T09:26:53.000Z',
    });
    expect(email.body).toContain('Timestamp: 2026-03-14T09:26:53.000Z');
  });
});

describe('osLabel', () => {
  it('maps win32 to Windows', () => {
    expect(osLabel('win32')).toBe('Windows');
  });

  it('maps darwin to macOS', () => {
    expect(osLabel('darwin')).toBe('macOS');
  });

  it('maps linux to Linux', () => {
    expect(osLabel('linux')).toBe('Linux');
  });

  it('falls back to the raw platform string for anything unrecognised, rather than hiding it', () => {
    expect(osLabel('freebsd')).toBe('freebsd');
  });
});
