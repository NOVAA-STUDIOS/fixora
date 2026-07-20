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
        // A left accent rail instead of a full-bleed tinted block. The old banner filled the pane
        // with colour and ran to four lines, which pushed the diff — the thing the user is actually
        // here to read — below the fold in a pane that is 260px wide to begin with. The verdict has
        // to be unmissable, not large: colour on the edge, one line of label, one line of reason.
        'flex shrink-0 items-start gap-2.5 border-b border-l-2 border-border-subtle px-3 py-2 text-xs',
        rejected
          ? 'border-l-danger bg-danger-subtle/40'
          : verified
            ? 'border-l-success bg-success-subtle/40'
            : 'border-l-warn bg-warn-subtle/40',
      ].join(' ')}
    >
      {/* The same badge the history list uses, so one verdict looks identical wherever it appears. */}
      <VerdictBadge verdict={report.verdict} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p
          className={[
            'font-semibold',
            rejected ? 'text-danger-text' : verified ? 'text-success-text' : 'text-fg',
          ].join(' ')}
        >
          {label}
        </p>
        <p className="leading-relaxed text-fg-secondary [overflow-wrap:anywhere]">{reason}</p>
        {!verified && (
          // The sentence the user most needs and is least likely to assume. The emphasis on NOT is
          // deliberate and stays: this is the line that separates "Fixora refused a bad patch" from
          // "Fixora damaged my file", and softening it for visual tidiness would trade the clarity
          // of a safety statement for a slightly calmer-looking banner. Weight is what changed —
          // medium-weight body copy rather than a bold third paragraph.
          <p className="font-medium text-fg">Your source code has NOT been modified.</p>
        )}
      </div>
    </div>
  );
}
