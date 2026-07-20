import { UserFacingError } from '@fixora/shared-types';

/**
 * Turning a filesystem errno into something a person can act on.
 *
 * Every `readFileSync`/`writeFileSync`/`statSync`/`readdirSync` in fs-service was unguarded, so a
 * routine Windows condition — a file open in another editor, a OneDrive placeholder not yet
 * hydrated, a permission-protected folder — threw a raw Node error. The router redacts thrown
 * errors, so all of them arrived as "Something went wrong handling that action."
 *
 * These are not rare. `EBUSY` happens whenever the user has the file open in VS Code and Fixora
 * tries to apply a repair; `EPERM` happens on any path Windows has decided to protect. A tool that
 * writes to source files has to say which of those happened, because the recovery is different for
 * each: close the other program, versus check permissions, versus the file is gone.
 *
 * The messages deliberately name the *situation*, not the errno. "EBUSY" tells a developer
 * something and a user nothing; "This file is open in another program" tells both.
 */

/** Node attaches `code` to filesystem errors. Narrowed here rather than cast at each call site. */
function errnoOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * Map an fs failure onto an authored error.
 *
 * `operation` reads as a verb phrase in the message ("read", "write to", "list"), and `relPath` is
 * workspace-relative — never absolute, because an absolute path is user data (Security §9) and this
 * message crosses to the renderer.
 */
export function toFsError(error: unknown, operation: string, relPath: string): UserFacingError {
  const errno = errnoOf(error);

  switch (errno) {
    case 'EBUSY':
    case 'ETXTBSY':
      return new UserFacingError(
        `Fixora could not ${operation} ${relPath} because another program is holding it open. ` +
          'Close it in your other editor and try again.',
        { code: 'fs_busy', action: { type: 'retry', label: 'Try again' }, stage: 'fs' },
      );

    case 'EPERM':
      // On Windows EPERM is far more often a lock or an attribute than a true permission problem —
      // antivirus scanning the file, a read-only flag, or a cloud-sync placeholder. Saying
      // "permission denied" would send the user to the wrong place, so the message lists what it
      // actually tends to be.
      return new UserFacingError(
        `Windows refused to let Fixora ${operation} ${relPath}. This is usually a read-only file, ` +
          'antivirus holding it briefly, or a cloud-synced file that has not finished downloading.',
        { code: 'fs_permission', action: { type: 'retry', label: 'Try again' }, stage: 'fs' },
      );

    case 'EACCES':
      return new UserFacingError(
        `Fixora does not have permission to ${operation} ${relPath}. Check the file's permissions, ` +
          'or reopen the project from a location you own.',
        { code: 'fs_access_denied', action: { type: 'none', label: 'Dismiss' }, stage: 'fs' },
      );

    case 'ENOENT':
      return new UserFacingError(
        `${relPath} no longer exists. It was probably moved, renamed or deleted since the project ` +
          'was analyzed — re-run analysis to refresh.',
        { code: 'fs_not_found', action: { type: 'none', label: 'Dismiss' }, stage: 'fs' },
      );

    case 'EISDIR':
      return new UserFacingError(`${relPath} is a folder, not a file.`, {
        code: 'fs_is_directory',
        stage: 'fs',
      });

    case 'EMFILE':
    case 'ENFILE':
      return new UserFacingError(
        'Fixora ran out of file handles. Close some other applications and try again.',
        { code: 'fs_too_many_open', action: { type: 'retry', label: 'Try again' }, stage: 'fs' },
      );

    case 'ENOSPC':
      return new UserFacingError(`There is no disk space left to ${operation} ${relPath}.`, {
        code: 'fs_no_space',
        action: { type: 'none', label: 'Dismiss' },
        stage: 'fs',
      });

    case 'EROFS':
      return new UserFacingError(
        `${relPath} is on a read-only filesystem, so it cannot be changed.`,
        {
          code: 'fs_read_only',
          stage: 'fs',
        },
      );

    case 'ELOOP':
      return new UserFacingError(
        `${relPath} is a symbolic link that points to itself, directly or through a chain.`,
        { code: 'fs_symlink_loop', stage: 'fs' },
      );

    default:
      // Unknown errno. Still authored — naming the operation and the path is far more use than the
      // generic router sentence — but the errno is included because an unrecognised one is exactly
      // the case where a maintainer needs the raw code.
      return new UserFacingError(
        `Fixora could not ${operation} ${relPath}${errno === null ? '' : ` (${errno})`}.`,
        { code: 'fs_unknown', action: { type: 'retry', label: 'Try again' }, stage: 'fs' },
      );
  }
}

/**
 * Run a filesystem operation, translating any failure.
 *
 * A wrapper rather than a try/catch at each site, so a new fs call cannot be added without either
 * using this or visibly not using it.
 */
export function fsTry<T>(operation: string, relPath: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    // An error we already authored passes through: `toFsError` would otherwise flatten a precise
    // message (a secret-denylisted path, an oversized file) into a generic fs one.
    if (error instanceof UserFacingError) throw error;
    throw toFsError(error, operation, relPath);
  }
}
