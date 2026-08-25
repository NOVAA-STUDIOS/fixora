import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Whether this launch is running a different build than the one that last ran — i.e. an update
 * (or downgrade) just took effect. A plain JSON file in `userData` (matching `repair-limit.ts`'s
 * approach), not SQLite: one string, read once at startup, no query ever needs it.
 */

interface Stored {
  version: string;
}

/** Reads the previously recorded version (if any), then overwrites it with `currentVersion` for
 *  next launch. Call once, at startup. `previousVersion` is `null` on a fresh install (nothing was
 *  ever recorded) — that case must never be read as "just updated". */
export function checkAndRecordLaunchedVersion(
  dir: string,
  currentVersion: string,
): { previousVersion: string | null } {
  const file = join(dir, 'version.json');
  let previousVersion: string | null = null;
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Stored>;
      if (typeof parsed.version === 'string') previousVersion = parsed.version;
    } catch (error) {
      console.error('[version] could not read last-launched version', {
        message: (error as Error).message,
      });
    }
  }

  try {
    // Atomic, same as `repair-limit.ts`'s `save()` — a truncating in-place write that loses power
    // mid-flush would otherwise leave corrupt JSON, read back next launch as "no file" (a false
    // fresh-install signal, which suppresses the What's New modal exactly when it should fire).
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: currentVersion } satisfies Stored), 'utf8');
    renameSync(tmp, file);
  } catch (error) {
    console.error('[version] could not persist last-launched version', {
      message: (error as Error).message,
    });
  }

  return { previousVersion };
}
