import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceService } from '../electron/main/services/workspace-service.js';

const showSaveDialog = vi.hoisted(() => vi.fn());
const openExternal = vi.hoisted(() => vi.fn());
const execFile = vi.hoisted(() => vi.fn());

// The router imports ipcMain and BrowserWindow; suggestions.handlers also imports dialog for
// export and (via security/mailto.js) shell for share. A light stub is enough for registration and
// for exercising both paths end to end.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => null), getFocusedWindow: vi.fn(() => null) },
  dialog: { showSaveDialog },
  shell: { openExternal },
}));

// BUG-F1-EMAIL-001 (part 2): on win32, mailto.ts checks the real Windows registry for a mailto:
// handler before ever calling shell.openExternal. Whatever machine these tests happen to run on
// (this one, at time of writing, genuinely has none registered) must not silently decide these
// tests' outcomes — mock it explicitly so the tests assert a chosen scenario, not local machine state.
vi.mock('node:child_process', () => ({
  execFile,
  default: { execFile },
}));

/** Simulates a registered mailto: handler — the success path assumes this by default. */
function mockMailtoHandlerPresent(): void {
  execFile.mockImplementation(
    (_cmd: string, _args: string[], cb: (err: Error | null, stdout: string) => void) => {
      cb(null, 'HKEY_CLASSES_ROOT\\mailto\\shell\\open\\command');
    },
  );
}

let dir: string;
let openDrivers: { close: () => void }[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mockMailtoHandlerPresent(); // default: a registered handler exists, tests override when testing its absence
  dir = mkdtempSync(join(tmpdir(), 'fixora-suggestions-handlers-'));
  openDrivers = [];
});
afterEach(() => {
  // The SQLite driver holds the db file open on Windows; close every one this test opened before
  // removing the temp dir, or rmSync fails with EPERM regardless of what the test itself asserted.
  for (const driver of openDrivers) driver.close();
  rmSync(dir, { recursive: true, force: true });
});

function fakeWorkspaceService(name: string | null): WorkspaceService {
  return {
    getCurrent: () => (name === null ? null : ({ id: 'w1', rootPath: '/tmp/w1', name, ignore: { ignores: () => false } } as never)),
  } as unknown as WorkspaceService;
}

async function freshHandlers(workspaceName: string | null = null) {
  vi.resetModules();
  const { getHandler } = await import('../electron/main/ipc/router.js');
  const { registerSuggestionHandlers } =
    await import('../electron/main/ipc/handlers/suggestions.handlers.js');
  const { openDatabase } = await import('../electron/main/db/database.js');
  const { createSuggestionRepository } =
    await import('../electron/main/suggestions/suggestion-repository.js');
  const { createSuggestionService } =
    await import('../electron/main/suggestions/suggestion-service.js');
  const { createSuggestionStorage } =
    await import('../electron/main/suggestions/suggestion-storage.js');
  const { createMailService } = await import('../electron/main/services/mail/mail-service.js');

  const { driver } = openDatabase({ dir });
  openDrivers.push(driver);
  const service = createSuggestionService({
    repository: createSuggestionRepository(createSuggestionStorage(driver)),
    appVersion: '1.5.0',
    platform: 'win32',
  });
  const mailService = createMailService({ platform: 'win32' });
  registerSuggestionHandlers(service, mailService, fakeWorkspaceService(workspaceName));
  return getHandler;
}

const ctx = { requestId: 'r1', window: null };

/**
 * End-to-end coverage of the Suggestion System's IPC surface: the exact request/response shapes the
 * renderer sends and receives, through real handlers wired to a real (temp) SQLite database — the
 * same wiring `main/index.ts` does, minus the Electron app lifecycle.
 */
describe('suggestions IPC handlers', () => {
  it('submit → list round-trips a suggestion', async () => {
    const getHandler = await freshHandlers();
    const submit = getHandler('suggestions:submit')!;
    const list = getHandler('suggestions:list')!;

    const submitted = await submit({ category: 'feature', message: 'Please add X' }, ctx);
    expect(submitted.suggestion.category).toBe('feature');

    const listed = await list({}, ctx);
    expect(listed.suggestions).toHaveLength(1);
    expect(listed.suggestions[0]?.id).toBe(submitted.suggestion.id);
  });

  it('submit rejects invalid input by throwing (the router turns this into a Result at the boundary)', async () => {
    const getHandler = await freshHandlers();
    const submit = getHandler('suggestions:submit')!;
    // The handler throws synchronously (it is not itself async), so the call must be wrapped in a
    // function for `.rejects` — calling it directly inside `expect()` would throw before `expect`
    // ever gets a promise to observe.
    await expect(async () => submit({ category: 'feature', message: 'short' }, ctx)).rejects.toThrow();
  });

  it('remove deletes one entry and returns the remaining list', async () => {
    const getHandler = await freshHandlers();
    const submit = getHandler('suggestions:submit')!;
    const remove = getHandler('suggestions:remove')!;

    const a = await submit({ category: 'bug', message: 'First bug report here' }, ctx);
    await submit({ category: 'bug', message: 'Second bug report here' }, ctx);

    const result = await remove({ id: a.suggestion.id }, ctx);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions.some((s) => s.id === a.suggestion.id)).toBe(false);
  });

  it('clear empties the list', async () => {
    const getHandler = await freshHandlers();
    const submit = getHandler('suggestions:submit')!;
    const clear = getHandler('suggestions:clear')!;

    await submit({ category: 'other', message: 'Something worth noting' }, ctx);
    const result = await clear({}, ctx);
    expect(result.suggestions).toEqual([]);
  });

  it('export writes a JSON file at the user-chosen path and returns it', async () => {
    const getHandler = await freshHandlers();
    const submit = getHandler('suggestions:submit')!;
    const exportHandler = getHandler('suggestions:export')!;

    await submit({ category: 'feature', message: 'Exportable suggestion text' }, ctx);

    const target = join(dir, 'export.json');
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target });

    const result = await exportHandler({}, ctx);
    expect(result.path).toBe(target);

    const written = JSON.parse(readFileSync(target, 'utf8')) as { message: string }[];
    expect(written).toHaveLength(1);
    expect(written[0]?.message).toBe('Exportable suggestion text');
  });

  it('export returns a null path when the user cancels the save dialog, without writing anything', async () => {
    const getHandler = await freshHandlers();
    const exportHandler = getHandler('suggestions:export')!;

    showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' });

    const result = await exportHandler({}, ctx);
    expect(result.path).toBeNull();
  });

  describe('suggestions:share (Sprint F1.1, F1.4 MailService)', () => {
    it('opens the mail client via shell.openExternal with a mailto: link carrying the right content (successful launch)', async () => {
      const getHandler = await freshHandlers();
      const submit = getHandler('suggestions:submit')!;
      const share = getHandler('suggestions:share')!;

      const submitted = await submit(
        { category: 'feature', message: 'Please add dark mode' },
        ctx,
      );

      const result = await share({ id: submitted.suggestion.id }, ctx);
      expect(result).toEqual({ status: 'opened' });

      expect(openExternal).toHaveBeenCalledTimes(1);
      const [calledUrl] = openExternal.mock.calls[0] as [string];
      expect(calledUrl.startsWith('mailto:novaa.support.team@gmail.com?')).toBe(true);
      const url = new URL(calledUrl);
      expect(url.searchParams.get('subject')).toBe('Fixora Suggestion - Feature request');
      expect(url.searchParams.get('body')).toContain('Please add dark mode');
      expect(url.searchParams.get('body')).toContain('Fixora version: 1.5.0');
      expect(url.searchParams.get('body')).toContain('Operating System: Windows');
      expect(url.searchParams.get('body')).toContain('Workspace: None');
      expect(url.searchParams.get('body')).toMatch(/Timestamp: \d{4}-\d{2}-\d{2}T/);
    });

    it('includes the open workspace name in the body when a workspace is open', async () => {
      const getHandler = await freshHandlers('my-project');
      const submit = getHandler('suggestions:submit')!;
      const share = getHandler('suggestions:share')!;

      const submitted = await submit(
        { category: 'feature', message: 'Please add dark mode' },
        ctx,
      );

      await share({ id: submitted.suggestion.id }, ctx);
      const [calledUrl] = openExternal.mock.calls[0] as [string];
      const url = new URL(calledUrl);
      expect(url.searchParams.get('body')).toContain('Workspace: my-project');
    });

    it('returns status: not_found and never calls openExternal for an id that does not exist', async () => {
      const getHandler = await freshHandlers();
      const share = getHandler('suggestions:share')!;

      const result = await share({ id: 'does-not-exist' }, ctx);
      expect(result).toEqual({ status: 'not_found' });
      expect(openExternal).not.toHaveBeenCalled();
    });

    it('never sends the suggestion anywhere on submit — only an explicit share call touches shell.openExternal', async () => {
      const getHandler = await freshHandlers();
      const submit = getHandler('suggestions:submit')!;
      await submit({ category: 'other', message: 'Just a local note for now' }, ctx);
      expect(openExternal).not.toHaveBeenCalled();
    });

    /**
     * BUG-F1-EMAIL-001. The previous implementation called `shell.openExternal` with `void` —
     * never awaited, never checked — and unconditionally returned `{ opened: true }`. Every
     * existing test up to this point used a bare `vi.fn()` for `openExternal`, which resolves
     * `undefined` by default and therefore could never expose that bug: the handler "passed"
     * regardless of what the OS actually did. This test is the one the original implementation
     * could not have passed.
     */
    it('returns status: no_mail_client with to/subject — never silently succeeds — when shell.openExternal rejects', async () => {
      const getHandler = await freshHandlers();
      const submit = getHandler('suggestions:submit')!;
      const share = getHandler('suggestions:share')!;

      const submitted = await submit(
        { category: 'bug', message: 'Crashes when opening a large repo' },
        ctx,
      );

      openExternal.mockRejectedValueOnce(
        new Error('No application is associated with the specified file for this operation'),
      );

      const result = await share({ id: submitted.suggestion.id }, ctx);
      expect(result).toEqual({
        status: 'no_mail_client',
        to: 'novaa.support.team@gmail.com',
        subject: 'Fixora Suggestion - Bug report',
        body: expect.stringContaining('Crashes when opening a large repo'),
      });
    });

    /**
     * BUG-F1-EMAIL-001, part 2 (MailService, Sprint F1.4). Real-runtime tracing (not a mock, not
     * this test suite) proved `shell.openExternal` can *resolve* for a `mailto:` URL even when
     * nothing on the machine can handle it — a rejection is not the only way this fails. On a real
     * Windows machine encountered during that investigation, this is exactly what happened: no
     * default mail client registered, `shell.openExternal` resolved, nothing opened, and the old
     * code reported success. `MailService` now checks the Windows registry *before* ever calling
     * `shell.openExternal`, so this is caught even when `shell.openExternal` would have lied.
     */
    it('on win32, returns status: no_mail_client before ever calling shell.openExternal when no handler is registered', async () => {
      execFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
          cb(new Error('The system was unable to find the specified registry key.'));
        },
      );

      const getHandler = await freshHandlers();
      const submit = getHandler('suggestions:submit')!;
      const share = getHandler('suggestions:share')!;

      const submitted = await submit(
        { category: 'other', message: 'A suggestion nobody can email yet' },
        ctx,
      );

      const result = await share({ id: submitted.suggestion.id }, ctx);
      expect(result).toEqual({
        status: 'no_mail_client',
        to: 'novaa.support.team@gmail.com',
        subject: 'Fixora Suggestion - Other',
        body: expect.stringContaining('A suggestion nobody can email yet'),
      });
      expect(openExternal).not.toHaveBeenCalled();
    });
  });

  describe('suggestions:shareViaGmail (Sprint F1.5)', () => {
    it('opens Gmail compose via shell.openExternal with the correct URL on a successful launch', async () => {
      const getHandler = await freshHandlers();
      const submit = getHandler('suggestions:submit')!;
      const shareViaGmail = getHandler('suggestions:shareViaGmail')!;

      const submitted = await submit({ category: 'feature', message: 'Add dark mode please' }, ctx);
      openExternal.mockResolvedValueOnce(undefined);

      const result = await shareViaGmail({ id: submitted.suggestion.id }, ctx);
      expect(result).toEqual({ status: 'opened' });

      expect(openExternal).toHaveBeenCalledTimes(1);
      const [calledUrl] = openExternal.mock.calls[0] as [string];
      const url = new URL(calledUrl);
      expect(url.origin).toBe('https://mail.google.com');
      expect(url.searchParams.get('to')).toBe('novaa.support.team@gmail.com');
      expect(url.searchParams.get('su')).toBe('Fixora Suggestion - Feature request');
      expect(url.searchParams.get('body')).toContain('Add dark mode please');
      expect(url.searchParams.get('body')).toContain('Workspace: None');
      expect(url.searchParams.get('body')).toMatch(/Timestamp: \d{4}-\d{2}-\d{2}T/);
    });

    it('returns status: not_found for an id that does not exist', async () => {
      const getHandler = await freshHandlers();
      const shareViaGmail = getHandler('suggestions:shareViaGmail')!;
      const result = await shareViaGmail({ id: 'does-not-exist' }, ctx);
      expect(result).toEqual({ status: 'not_found' });
      expect(openExternal).not.toHaveBeenCalled();
    });

    it('returns status: browser_failed (never throws) when shell.openExternal rejects (browser launch failure)', async () => {
      const getHandler = await freshHandlers();
      const submit = getHandler('suggestions:submit')!;
      const shareViaGmail = getHandler('suggestions:shareViaGmail')!;

      const submitted = await submit({ category: 'other', message: 'Some note about Fixora' }, ctx);
      openExternal.mockRejectedValueOnce(new Error('no browser found'));

      const result = await shareViaGmail({ id: submitted.suggestion.id }, ctx);
      expect(result).toEqual({ status: 'browser_failed' });
    });
  });
});
