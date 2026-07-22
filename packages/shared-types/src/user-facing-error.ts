/**
 * An error a handler *means* to show the user.
 *
 * The router redacts thrown errors on purpose: a stack carries absolute paths, and absolute paths
 * are user data (Security §9). That protection is right and stays. What it could not do is tell the
 * difference between an unexpected crash — where redaction is exactly correct — and a condition the
 * handler anticipated and wrote a sentence for. Both arrived as "Something went wrong handling that
 * action.", so a handler could carefully explain a missing key or a network timeout and have that
 * explanation thrown away.
 *
 * Throwing this is a handler saying: *I anticipated this, the message is written for a human, and I
 * assert it contains no paths or secrets.* Anything else thrown is still fully redacted.
 *
 * The safer shape remains returning a typed result (see `ApplyOutcome`), and handlers that can
 * should. This exists for the ones that cannot restructure — and for the deep call stacks, like a
 * provider adapter, where an exception is the only way back out.
 */
export class UserFacingError extends Error {
  override readonly name = 'UserFacingError';

  constructor(
    message: string,
    readonly options: {
      /** Stable machine code for tests and diagnostics, e.g. 'provider_timeout'. */
      readonly code: string;
      /** What the user can do next. Omitted means the UI shows no action. */
      readonly action?: {
        readonly type: 'none' | 'retry' | 'open_settings';
        readonly label: string;
      };
      /** Where in the pipeline this happened, for the Developer Details panel. */
      readonly stage?: string;
    },
  ) {
    super(message);
  }
}

/** Type guard usable across the process boundary, where `instanceof` is unreliable. */
export function isUserFacingError(error: unknown): error is UserFacingError {
  // Cast to an OPTIONAL shape, not to UserFacingError: across the IPC boundary this really is an
  // unknown that merely looks like one, so `options` genuinely may be absent and the `?.` is load-
  // bearing. Casting to the class would tell the type-checker `options` is always present and the
  // guard would be quietly defeated.
  return (
    error instanceof Error &&
    error.name === 'UserFacingError' &&
    typeof (error as { options?: { code?: unknown } }).options?.code === 'string'
  );
}
