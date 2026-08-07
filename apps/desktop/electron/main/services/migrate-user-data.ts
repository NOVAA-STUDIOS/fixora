import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One-time recovery for BUG: "API keys lost after update."
 *
 * Root cause: `apps/desktop/package.json` has no `productName` field, so before `app.setName
 * ('Fixora')` was added (index.ts), Electron's default `app.name` fell back to the scoped `name`
 * field — `@fixora/desktop`. `app.getPath('userData')` is `join(appData, app.name)`, and
 * `path.join` normalises the `/` in that string the same as a path separator, so every build
 * before that fix wrote credentials to a *nested* `appData/@fixora/desktop`, not `appData/Fixora`.
 * A user who installed one of those builds and then upgraded past the fix got a correctly-named
 * but empty `userData` — their encrypted provider keys were never lost, just orphaned in the old
 * directory the app no longer looks at.
 *
 * Copies the two credential files only (never the SQLite DB — findings/history are cheap to
 * regenerate; a partial DB copy is not worth the risk). Runs once, before any store opens the
 * *current* userData dir, and is a no-op the moment either side is as expected (new dir already
 * has the file, or no legacy dir exists — e.g. a fresh install, or macOS/Linux where the join
 * quirk does not occur because `app.name` there was never used to build a filesystem path the
 * same way... in practice this only ever mattered on Windows, but the check is cheap everywhere).
 */
export function migrateLegacyUserData(appDataDir: string, userDataDir: string): void {
  const legacyDir = join(appDataDir, '@fixora', 'desktop');
  if (!existsSync(legacyDir)) return;

  for (const file of ['ai-providers.json', 'ai-credentials.json']) {
    const from = join(legacyDir, file);
    const to = join(userDataDir, file);
    if (existsSync(from) && !existsSync(to)) {
      try {
        copyFileSync(from, to);
        console.error('[migrate] recovered', { file, from, to });
      } catch (error) {
        console.error('[migrate] failed to recover a legacy credential file', {
          file,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
