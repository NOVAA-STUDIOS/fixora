import type { AiProposal } from '@fixora/shared-types';
import { cn } from '@fixora/ui';

import { validationBadges } from './validation-badges.js';

/**
 * "Prove the Fix" — the verification card answers "did this actually work", not just "the model
 * says it worked". Every line here traces to a real check `validationBadges`/`proposal.verification`
 * already ran; nothing is claimed that wasn't proven. In particular: **there is no client-visible
 * retry-attempt count.** `ai-service.ts`'s VERIFY_RETRY_LIMIT loop runs entirely in main, and only the
 * best of up to 3 attempts is ever returned to the renderer — so "verified on first try vs. after a
 * retry" is not data this component has. Confidence is derived instead from how many independent
 * checks corroborate the verdict (syntax+regression alone vs. also lint/type), which IS real,
 * available data — not from a number this component would otherwise have to invent.
 */

type ProveCheck = { label: string; passed: boolean; detail: string };

function buildChecks(proposal: Extract<AiProposal, { profile: 'repair' }>): ProveCheck[] {
  const report = proposal.verification;
  const badges = validationBadges(proposal);
  const checks: ProveCheck[] = [
    { label: 'Syntax valid', passed: report.syntaxOk, detail: 'The patched file parses cleanly.' },
    {
      label: 'Original issue resolved',
      passed: report.verdict !== 'unresolved',
      detail:
        report.verdict === 'unresolved'
          ? 'The finding this repair targeted is still present.'
          : 'The finding this repair targeted is gone.',
    },
    {
      label:
        report.newFindingCount > 0
          ? `New issues introduced (${String(report.newFindingCount)})`
          : 'No new issues introduced',
      passed: report.newFindingCount === 0,
      detail: 'Re-analyzed after the change, compared against the baseline.',
    },
  ];
  const typeBadge = badges.find((b) => b.name === 'Type');
  // Only shown when a type checker actually ran on this file — not-run is never rendered as a
  // check, the same rule validation-badges.ts enforces for the badge row this reuses.
  if (typeBadge !== undefined && typeBadge.status !== 'not-run') {
    checks.push({
      label: typeBadge.status === 'pass' ? 'Type check passed' : 'Type check failed',
      passed: typeBadge.status === 'pass',
      detail: typeBadge.detail,
    });
  }
  return checks;
}

function confidenceFor(
  proposal: Extract<AiProposal, { profile: 'repair' }>,
  checks: readonly ProveCheck[],
): 'High' | 'Medium' | 'Low' {
  if (proposal.verification.verdict !== 'verified') return 'Low';
  if (checks.some((c) => !c.passed)) return 'Low';
  // Verified is real either way — this only asks how much independent evidence backs it. Syntax +
  // regression alone (every language gets these) is real but thinner than also having lint/type
  // corroborate it.
  const badges = validationBadges(proposal);
  const corroborated = badges.some(
    (b) => (b.name === 'Lint' || b.name === 'Type') && b.status !== 'not-run',
  );
  return corroborated ? 'High' : 'Medium';
}

export function ProveTheFixBadge({
  proposal,
}: {
  proposal: Extract<AiProposal, { profile: 'repair' }>;
}): React.JSX.Element {
  const verified = proposal.verification.verdict === 'verified';
  const checks = buildChecks(proposal);
  const confidence = confidenceFor(proposal, checks);

  return (
    <div
      className={cn(
        'animate-ios-enter overflow-hidden rounded-lg border',
        verified ? 'border-success-text/30 bg-success-subtle' : 'border-danger-text/30 bg-danger-subtle',
      )}
    >
      <div className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold">
        <span aria-hidden="true">{verified ? '✅' : '❌'}</span>
        <span className={verified ? 'text-success-text' : 'text-danger-text'}>
          {verified ? 'Repair Verified' : 'Repair Could Not Be Verified'}
        </span>
      </div>
      <div className="border-t border-border-subtle">
        <ul className="flex flex-col gap-1 px-3 py-2">
          {checks.map((check, i) => (
            <li
              key={check.label}
              title={check.detail}
              // Staggered entrance: each row is its own spring-in, offset 150ms behind the last —
              // the checks read as being confirmed one at a time, not dumped on screen at once.
              className="animate-ios-enter flex items-center gap-2 text-xs"
              style={{ animationDelay: `${String(i * 150)}ms`, animationFillMode: 'backwards' }}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'shrink-0 font-semibold',
                  check.passed ? 'text-success-text' : 'text-danger-text',
                )}
              >
                {check.passed ? '✓' : '✗'}
              </span>
              <span className="text-fg-secondary">{check.label}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="border-t border-border-subtle px-3 py-1.5 text-[11px] text-fg-muted">
        {verified ? (
          <>
            Confidence:{' '}
            <span
              className={cn(
                'font-semibold',
                confidence === 'High'
                  ? 'text-success-text'
                  : confidence === 'Medium'
                    ? 'text-warn-text'
                    : 'text-danger-text',
              )}
            >
              {confidence}
            </span>
          </>
        ) : (
          'Review before applying.'
        )}
      </div>
    </div>
  );
}
