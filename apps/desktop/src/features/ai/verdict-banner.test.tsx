import type { VerificationReport } from '@fixora/shared-types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { VerdictBanner } from './verdict-banner.js';

/**
 * These tests exist because of a specific misreading that cost real investigation time.
 *
 * The panel used to print "verified against syntax, tsc" for every proposal — including ones
 * verification had *rejected*. So a refused patch read as an applied one, and its malformed diff
 * looked like damage Fixora had done to the user's file. It had done the opposite: caught the bad
 * patch and refused to apply it.
 *
 * The assertions below are therefore about wording, not markup. They are the contract that a rejected
 * patch can never again be mistaken for an applied one.
 */

function report(overrides: Partial<VerificationReport>): VerificationReport {
  return {
    verdict: 'verified',
    targetResolved: true,
    newFindingCount: 0,
    syntaxOk: true,
    ran: ['syntax', 'tsc'],
    ...overrides,
  };
}

describe('VerdictBanner', () => {
  it('states plainly that nothing was written when a patch is rejected', () => {
    render(
      <VerdictBanner
        report={report({
          verdict: 'regression',
          syntaxOk: false,
          note: 'The fix does not parse — it would break the file.',
        })}
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('Rejected patch');
    // The reason, so the badge is never unexplained.
    expect(screen.getByRole('status').textContent).toContain('does not parse');
    // The sentence the user most needs and is least likely to assume.
    expect(screen.getByRole('status').textContent).toContain(
      'Your source code has NOT been modified',
    );
  });

  it('never uses the word "verified" for a patch that was not verified', () => {
    for (const verdict of ['regression', 'unresolved', 'skipped'] as const) {
      const { unmount } = render(<VerdictBanner report={report({ verdict })} />);
      expect(screen.getByRole('status').textContent).not.toContain('Verified');
      unmount();
    }
  });

  it('does not claim the file is untouched when the patch is verified and appliable', () => {
    // The reassurance is only true before Apply. Showing it on a verified patch would be a different
    // lie in the opposite direction.
    render(<VerdictBanner report={report({ verdict: 'verified' })} />);
    const text = screen.getByRole('status').textContent;
    expect(text).toContain('Verified patch');
    expect(text).not.toContain('NOT been modified');
  });

  it('distinguishes a patch that is safe from one that simply does not fix anything', () => {
    render(
      <VerdictBanner
        report={report({ verdict: 'unresolved', note: 'The fix did not resolve the finding.' })}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('does not fix the problem');
  });

  /**
   * Beta audit A5: verification re-analyzes only the one changed file, never the rest of the
   * project — a caller elsewhere that a fix breaks would not be caught. The default "Verified"
   * reason (no explicit `note` from the backend) must say so, not read as a project-wide guarantee.
   */
  it('scopes the default "Verified" explanation to this file, not the whole project', () => {
    render(<VerdictBanner report={report({ verdict: 'verified' })} />);
    const text = screen.getByRole('status').textContent;
    expect(text).toContain('this file');
    expect(text).not.toMatch(/nothing new broke/i);
  });
});
