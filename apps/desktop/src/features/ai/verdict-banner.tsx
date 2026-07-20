import type { VerificationReport } from '@fixora/shared-types';

import { VerdictBadge } from './verdict-badge.js';

/**
 * The verdict, stated before anything else on screen.
 *
 * This exists because of a real misreading: the panel used to say "verified against syntax, tsc"
 * for *every* proposal, including ones verification had rejected — so a patch that was refused read
 * as a patch that had been applied, and a malformed diff looked like damage Fixora had done to the
 * user's file. It had done the opposite: it caught the bad patch and refused it.
 *
 * So the rules here are: name the outcome in the first line, never use the word "verified" unless the
 * verdict actually is, and on any non-applied outcome say plainly that the file on disk is untouched.
 * A tool that just protected you should not look like a tool that broke you.
 */
export function VerdictBanner({ report }: { report: VerificationReport }): React.JSX.Element {
  const rejected = report.verdict === 'regression';
  const verified = report.verdict === 'verified';

  const label = rejected
    ? 'Rejected patch'
    : verified
      ? 'Verified patch'
      : report.verdict === 'unresolved'
        ? 'Proposed patch — does not fix the problem'
        : 'Proposed patch — not verified';

  // `note` carries the specific reason (does not parse / introduces N new problems). Fall back to a
  // plain sentence rather than leaving the badge unexplained.
  const reason =
    report.note ??
    (verified
      ? 'The analyzers were re-run against this change and found no new problems.'
      : 'Fixora could not confirm this change is safe.');

  return (
    <div
      // Announced, because the verdict is the single most important thing in this panel and a
      // screen-reader user must not have to hunt for it.
      role="status"
      className={[
        'shrink-0 border-b border-border-subtle px-3 py-2 text-xs',
        rejected
          ? 'bg-danger-subtle text-danger-text'
          : verified
            ? 'bg-success-subtle text-success-text'
            : 'bg-warn-subtle text-fg-secondary',
      ].join(' ')}
    >
      {/* The same badge the history list uses, so one verdict looks identical wherever it appears. */}
      <p className="flex items-center gap-1.5 font-medium">
        <VerdictBadge verdict={report.verdict} />
        {label}
      </p>
      <p className="mt-0.5 [overflow-wrap:anywhere]">{reason}</p>
      {!verified && (
        // The sentence the user most needs and is least likely to assume.
        <p className="mt-1 font-medium">Your source code has NOT been modified.</p>
      )}
    </div>
  );
}
