import { execFile } from 'node:child_process';

/**
 * Per-platform detection of "is anything actually registered to open a mailto: link". This exists
 * because `shell.openExternal` cannot answer that question itself — its Promise resolves when the
 * OS was *asked* to launch a handler, not when one is confirmed to exist (see `mail-service.ts`'s
 * doc comment for the real-world evidence that forced this). Each check uses only OS-builtin
 * tooling — no new runtime dependency.
 *
 * Every check is wrapped by hand (a plain `Promise` around a callback), not `util.promisify`:
 * `child_process.execFile` defines a `util.promisify.custom` override that resolves
 * `{ stdout, stderr }`, which is a property of the *real* function, not something a mocked one in a
 * test reproduces for free — a hand-rolled wrapper behaves identically in production and under test.
 */

export function hasWindowsMailtoHandler(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCR\\mailto\\shell\\open\\command'], (error, stdout) => {
      // `reg query` exits non-zero when the key does not exist — absence, not a tool failure.
      resolve(error === null && stdout.trim().length > 0);
    });
  });
}

/**
 * macOS LaunchServices records the default handler for a URL scheme in the LaunchServices
 * database, readable via the builtin `defaults` command. A registered `mailto:` handler has an
 * `LSHandlerURLScheme = mailto` entry whose `LSHandlerRoleAll` is an app bundle id; an entry with
 * no handler reads `LSHandlerRoleAll = "-"` (or is absent from the list entirely). This is a
 * heuristic over a private, undocumented plist format Apple can change — it is the same mechanism
 * command-line tools like `duti` use, and `MailService` treats "could not parse" the same as
 * "no handler" (fail closed, never assume success), documented as a known limitation.
 */
export function hasMacMailtoHandler(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'defaults',
      ['read', 'com.apple.LaunchServices/com.apple.launchservices.secure', 'LSHandlers'],
      (error, stdout) => {
        if (error !== null) {
          resolve(false);
          return;
        }
        // `defaults read` prints each handler as its own `{ ... }` dict; key order within a dict is
        // not guaranteed (it is generally alphabetical, which would put LSHandlerRoleAll BEFORE
        // LSHandlerURLScheme), so this scans each whole dict block for both keys independently
        // rather than assuming either comes first.
        const dictBlocks = stdout.match(/\{[^{}]*\}/g) ?? [];
        const mailtoBlock = dictBlocks.find((block) =>
          /LSHandlerURLScheme\s*=\s*"?mailto"?;/.test(block),
        );
        if (mailtoBlock === undefined) {
          resolve(false);
          return;
        }
        const role = /LSHandlerRoleAll\s*=\s*"?([^";]+)"?;/.exec(mailtoBlock);
        const bundleId = role?.[1]?.trim();
        resolve(bundleId !== undefined && bundleId !== '-' && bundleId.length > 0);
      },
    );
  });
}

/**
 * Linux has no single registry — `xdg-mime query default x-scheme-handler/mailto` returns the
 * `.desktop` file registered for the scheme, if any, and is the most direct signal available. If
 * `xdg-mime` itself is not installed (uncommon but possible on a minimal system), this falls back
 * to checking whether `xdg-email` is on `PATH` at all — a weaker signal ("the tooling exists") than
 * "a handler is registered", documented as a known limitation rather than hidden.
 */
export function hasLinuxMailtoHandler(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('xdg-mime', ['query', 'default', 'x-scheme-handler/mailto'], (error, stdout) => {
      if (error === null && stdout.trim().length > 0) {
        resolve(true);
        return;
      }
      execFile('which', ['xdg-email'], (error2, stdout2) => {
        resolve(error2 === null && stdout2.trim().length > 0);
      });
    });
  });
}

/** Dispatches to the right platform check; an unrecognised platform is not blocked on a check we
 *  have no implementation for — it falls through to `shell.openExternal`'s own resolve/reject. */
export function hasMailtoHandler(platform: string): Promise<boolean> {
  if (platform === 'win32') return hasWindowsMailtoHandler();
  if (platform === 'darwin') return hasMacMailtoHandler();
  if (platform === 'linux') return hasLinuxMailtoHandler();
  return Promise.resolve(true);
}
