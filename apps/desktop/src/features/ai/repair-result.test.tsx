import type { AiProposal, Finding } from '@fixora/shared-types';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/bridge.js', () => ({
  invoke: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
  subscribe: () => () => undefined,
}));
// Monaco cannot mount in jsdom, and this test is about the panel's layout, not the diff's internals.
const diffProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock('../editor/diff-editor.js', () => ({
  DiffEditor: (props: Record<string, unknown>) => {
    diffProps.current = props;
    return <div data-testid="diff-editor" />;
  },
}));
const revealAt = vi.hoisted(() => vi.fn());
vi.mock('../workspace/workspace-store.js', () => ({
  useWorkspaceStore: (selector: (s: { revealAt: typeof revealAt }) => unknown) =>
    selector({ revealAt }),
}));

import { useUiStore } from '../../stores/ui-store.js';

import { buildPatchText, RepairResult } from './repair-result.js';

/**
 * ISSUE 1 regression: the repair panel.
 *
 * The defects being pinned here were all real. The diagnostics panel was `shrink-0` with unbounded
 * height inside an `overflow-hidden` column and no scroll container, so expanding it CLIPPED content
 * with no way to reach it. Rule id and severity never rendered at all (they live in `ProblemDetails`,
 * which shows *instead of* the result). "Copy" copied only the replacement code while being labelled
 * as though it copied a patch. And a rejection rendered as a full-width banner that displaced the
 * whole panel.
 */

type Repair = Extract<AiProposal, { profile: 'repair' }>;

function proposal(over: Partial<Repair> = {}): Repair {
  return {
    profile: 'repair',
    historyId: 'h1',
    repairedCode: 'const a = 2;',
    originalCode: 'const a = 1;',
    rationale: 'Short reason.',
    confidence: 0.92,
    target: { file: 'src/a.ts', startLine: 3, endLine: 3, symbolName: 'a' },
    verification: {
      verdict: 'verified',
      targetResolved: true,
      newFindingCount: 0,
      syntaxOk: true,
      ran: ['syntax', 'eslint'],
    },
    ...over,
  };
}

function finding(): Finding {
  return {
    id: 'f1',
    source: 'eslint',
    ruleId: 'prefer-const',
    severity: 'warning',
    category: 'maintainability',
    location: { file: 'src/a.ts', startLine: 3, startCol: 1, endLine: 3, endCol: 5 },
    message: 'Prefer const.',
    evidence: { snippet: '', relatedLocations: [], toolOutput: null },
    fixable: true,
    repair: 'ai-required',
    confidence: 1,
  };
}

describe('RepairResult — first screen', () => {
  it('shows rule id, severity, confidence and all four validation badges without scrolling', () => {
    render(<RepairResult proposal={proposal()} finding={finding()} />);
    expect(screen.getByText('prefer-const')).toBeInTheDocument();
    expect(screen.getByText('warning')).toBeInTheDocument();
    expect(screen.getByText('92%')).toBeInTheDocument();
    const validation = screen.getByRole('list', { name: 'Validation' });
    for (const name of ['Syntax', 'Lint', 'Type', 'Regression']) {
      expect(validation).toHaveTextContent(name);
    }
  });

  it('renders without a finding (it may no longer be loaded) rather than crashing', () => {
    render(<RepairResult proposal={proposal()} finding={null} />);
    expect(screen.getByText('92%')).toBeInTheDocument();
  });
});

/**
 * The panel no longer renders code.
 *
 * The diff used to be this panel's primary surface. In the editor-first workflow it is drawn inline
 * in the editor instead — the replaced lines marked in place, the proposed lines beneath them — and
 * this panel is reserved for what the editor cannot show: why the problem happened, what was
 * verified, and what the risk is. These pin that separation, because regressing it means showing the
 * user the same code twice in two places and asking them to reconcile the two.
 */
describe('RepairResult — the panel explains, the editor shows the code', () => {
  it('never mounts a diff editor', () => {
    render(<RepairResult proposal={proposal()} finding={finding()} />);
    expect(screen.queryByTestId('diff-editor')).not.toBeInTheDocument();
  });

  it('renders no diff even for a REJECTED patch', () => {
    render(
      <RepairResult
        proposal={proposal({
          verification: {
            verdict: 'regression',
            targetResolved: true,
            newFindingCount: 2,
            syntaxOk: true,
            ran: ['syntax'],
            note: 'introduces 2 new problem(s).',
          },
        })}
        finding={finding()}
      />,
    );
    expect(screen.queryByTestId('diff-editor')).not.toBeInTheDocument();
    // The rejection itself is still explained here — that is the panel's job.
    expect(screen.getByText(/Apply is disabled/)).toBeInTheDocument();
  });

  it('still names the file and range the change covers, without rendering it', () => {
    render(
      <RepairResult
        proposal={proposal({
          target: { file: 'src/a.ts', startLine: 120, endLine: 140, symbolName: null },
        })}
        finding={finding()}
      />,
    );
    expect(screen.getByText(/a.ts:120–140/)).toBeInTheDocument();
  });

  it('points the user at the editor rather than leaving the absence unexplained', () => {
    render(<RepairResult proposal={proposal()} finding={finding()} />);
    expect(screen.getByText(/Review the change in the editor/)).toBeInTheDocument();
  });

  it('offers Open Full Diff for the traditional side-by-side view', () => {
    render(<RepairResult proposal={proposal()} finding={finding()} />);
    const button = screen.getByRole('button', { name: 'Open Full Diff' });
    fireEvent.click(button);
    // The overlay is opened through the ui store, so the panel does not own a second diff surface.
    expect(useUiStore.getState().fullDiffOpen).toBe(true);
    useUiStore.getState().closeFullDiff();
  });

  it('has no diff-view toggle — that moved to the full-diff overlay', () => {
    render(
      <RepairResult
        proposal={proposal({
          mode: 'ai-file',
          target: { file: 'src/a.ts', startLine: 1, endLine: 200, symbolName: null },
        })}
        finding={finding()}
      />,
    );
    expect(screen.queryByRole('group', { name: 'Diff view' })).not.toBeInTheDocument();
  });
});
describe('RepairResult — explanations collapse by default', () => {
  it('the rationale is hidden behind a Show explanation control', () => {
    render(<RepairResult proposal={proposal()} finding={finding()} />);
    const toggle = screen.getByRole('button', { name: 'Show explanation' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Short reason.')).not.toBeInTheDocument();
  });

  it('expands to reveal the full rationale on demand, however long', () => {
    const long = 'x'.repeat(400);
    render(<RepairResult proposal={proposal({ rationale: long })} finding={finding()} />);
    const toggle = screen.getByRole('button', { name: 'Show explanation' });
    fireEvent.click(toggle);
    expect(screen.getByText(long)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide explanation' })).toBeInTheDocument();
  });
});

describe('RepairResult — rejection is compact', () => {
  it('renders the reason in a single alert, not a panel-displacing banner', () => {
    render(
      <RepairResult
        proposal={proposal({
          verification: {
            verdict: 'regression',
            targetResolved: true,
            newFindingCount: 2,
            syntaxOk: true,
            ran: ['syntax', 'eslint'],
            note: 'The fix resolves the finding but introduces 2 new problem(s).',
          },
        })}
        finding={finding()}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Apply is disabled');
    expect(alert).toHaveTextContent('introduces 2 problem(s) the file did not have before');
    // A blocked control must say what to do next, not just that it is blocked.
    expect(alert).toHaveTextContent('Re-run Repair');
    expect(alert).toHaveTextContent('Nothing has been written to your file.');
    // Apply must be refused for a regression — the safety gate, unchanged by the redesign.
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });
});

describe('RepairResult — repair summary', () => {
  const withSummary = proposal({
    repairSummary: {
      fixed: [{ ruleId: 'prefer-const', line: 3, message: 'Prefer const.' }],
      related: [{ ruleId: 'no-unused-vars', line: 4, message: 'Unused x.' }],
      skipped: [
        { ruleId: 'TS2304', line: 9, message: 'Cannot find name.', reason: 'Needs your judgment.' },
      ],
    },
  });

  it('lists fixed, related and skipped problems', () => {
    render(<RepairResult proposal={withSummary} finding={finding()} />);
    expect(screen.getByText(/Prefer const\./)).toBeInTheDocument();
    expect(screen.getByText(/Unused x\./)).toBeInTheDocument();
    expect(screen.getByText(/Cannot find name\./)).toBeInTheDocument();
  });

  it('gives a REASON for every skipped problem — the point of the section', () => {
    render(<RepairResult proposal={withSummary} finding={finding()} />);
    expect(screen.getByText('Needs your judgment.')).toBeInTheDocument();
  });

  it('is absent, not broken, when the proposal carries no summary', () => {
    render(<RepairResult proposal={proposal()} finding={finding()} />);
    expect(screen.queryByText(/Repair summary/i)).not.toBeInTheDocument();
  });

  it('coexists with the change summary rather than replacing it', () => {
    // The summary and the "what changed" row are both panel content and must not displace each
    // other; the code itself is in the editor, so neither competes with a diff for the space.
    render(<RepairResult proposal={withSummary} finding={finding()} />);
    expect(screen.getByText(/Repair summary/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Full Diff' })).toBeInTheDocument();
    expect(screen.queryByTestId('diff-editor')).not.toBeInTheDocument();
  });
});

describe('RepairResult — action bar', () => {
  it('always exposes Apply, Preview Diff and Copy Patch', () => {
    render(<RepairResult proposal={proposal()} finding={finding()} />);
    for (const name of ['Apply', 'Copy Patch', 'Dismiss']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('Copy Patch copies a real before/after patch, not just the replacement code', () => {
    const patch = buildPatchText(proposal());
    expect(patch).toContain('src/a.ts:3-3');
    expect(patch).toContain('--- before');
    expect(patch).toContain('const a = 1;');
    expect(patch).toContain('+++ after');
    expect(patch).toContain('const a = 2;');
  });
});

describe('RepairResult — the status card', () => {
  it('separates mode, scope, lines and verification as distinct labelled facts', () => {
    render(<RepairResult proposal={proposal({ mode: 'finding' })} finding={finding()} />);
    expect(screen.getByText('Repair Finding')).toBeInTheDocument();
    expect(screen.getByText(/Selected finding only/)).toBeInTheDocument();
    expect(screen.getByText(/lines 3–3/)).toBeInTheDocument();
    expect(screen.getByText('Verification')).toBeInTheDocument();
  });

  it('rates a one-line patch as Low impact, and says what that was measured from', () => {
    render(<RepairResult proposal={proposal({ mode: 'finding' })} finding={finding()} />);
    expect(screen.getByText('Low impact')).toBeInTheDocument();
    expect(screen.getByText('1 line replaced')).toBeInTheDocument();
  });

  it('rates a whole-file patch as High impact and marks the mode Advanced', () => {
    render(
      <RepairResult
        proposal={proposal({
          mode: 'ai-file',
          target: { file: 'src/a.ts', startLine: 1, endLine: 120, symbolName: null },
        })}
        finding={finding()}
      />,
    );
    expect(screen.getByText('AI File Repair (Advanced)')).toBeInTheDocument();
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.getByText('High impact')).toBeInTheDocument();
    expect(screen.getByText(/Entire file/)).toBeInTheDocument();
  });

  it('rates a large default-mode patch High too — size decides, not mode', () => {
    render(
      <RepairResult
        proposal={proposal({
          mode: 'finding',
          target: { file: 'src/a.ts', startLine: 10, endLine: 90, symbolName: null },
        })}
        finding={finding()}
      />,
    );
    expect(screen.getByText('High impact')).toBeInTheDocument();
  });

  it('still shows the validation badges inside the card', () => {
    render(<RepairResult proposal={proposal()} finding={finding()} />);
    const validation = screen.getByRole('list', { name: 'Validation' });
    for (const name of ['Syntax', 'Lint', 'Type', 'Regression']) {
      expect(validation).toHaveTextContent(name);
    }
  });

  it('falls back to the default mode label when a proposal carries none', () => {
    render(<RepairResult proposal={proposal()} finding={finding()} />);
    expect(screen.getByText('Repair Finding')).toBeInTheDocument();
  });
});

/**
 * The Root Cause View — Advanced Repair only. Answers "why is this touching a different line than
 * the one I selected", and must never look like a second source of truth competing with the
 * validation badges, which is what actually confirms anything.
 */
describe('RepairResult — Root Cause View', () => {
  it('shows a fallback, not a fabricated basis, when the proposal carries no rootCause', () => {
    render(<RepairResult proposal={proposal({ mode: 'finding' })} finding={finding()} />);
    expect(screen.getByText('Root cause')).toBeInTheDocument();
    expect(screen.getByText(/Selected location — not retargeted\./)).toBeInTheDocument();
    expect(screen.queryByText('different location')).not.toBeInTheDocument();
  });

  it('shows the root-cause finding, its basis, and flags a different location', () => {
    render(
      <RepairResult
        proposal={proposal({
          mode: 'advanced',
          rootCause: {
            basis: 'identifier',
            ruleId: 'TS2304',
            message: "Cannot find name 'config'.",
            line: 5,
            differsFromSelection: true,
            affected: [
              { ruleId: 'TS2304', line: 40, message: "Cannot find name 'config'." },
              { ruleId: 'TS2304', line: 80, message: "Cannot find name 'config'." },
            ],
          },
        })}
        finding={finding()}
      />,
    );
    expect(screen.getByText('Root cause')).toBeInTheDocument();
    expect(screen.getByText('different location')).toBeInTheDocument();
    expect(screen.getByText('TS2304')).toBeInTheDocument();
    expect(screen.getByText(/Same missing name, found elsewhere/)).toBeInTheDocument();
    expect(screen.getByText(/Estimated 2 diagnostics may clear/)).toBeInTheDocument();
    // Never presented as confirmed — the validation badges are what confirm anything.
    expect(screen.getByText(/confirmed by validation below, not by this estimate/)).toBeInTheDocument();
  });

  it('does not claim a different location when the user selected the root cause itself', () => {
    render(
      <RepairResult
        proposal={proposal({
          mode: 'advanced',
          rootCause: {
            basis: 'scope',
            ruleId: 'json-parse',
            message: 'Invalid JSON',
            line: 3,
            differsFromSelection: false,
            affected: [],
          },
        })}
        finding={finding()}
      />,
    );
    expect(screen.getByText('Root cause')).toBeInTheDocument();
    expect(screen.queryByText('different location')).not.toBeInTheDocument();
    // No affected findings — no fabricated estimate line.
    expect(screen.queryByText(/may clear as a side effect/)).not.toBeInTheDocument();
  });
});

/**
 * The scope-expansion disclosure.
 *
 * When the engine widens a repair after a dependent verification failure, the diff covers more than
 * the line the user clicked. Unexplained, that reads as the engine overreaching — it is the opposite:
 * the narrow patch was tried first and the verifier proved it could not compile alone. The card has
 * to say so, both to justify the larger diff and, when the widened attempt also failed, to report the
 * materially different outcome "a larger fix was tried and still did not compile".
 */
describe('RepairResult — scope expansion', () => {
  const expansion = {
    reason:
      'The patch still fails on TS2339, which is caused by a declaration outside the code it replaces.',
    from: { startLine: 3, endLine: 3 },
    to: { startLine: 1, endLine: 5 },
  };

  function expanded(over: Partial<Repair> = {}): Repair {
    return proposal({
      scopeExpansion: expansion,
      target: { file: 'src/a.ts', startLine: 1, endLine: 5, symbolName: 'load' },
      ...over,
    });
  }

  it('names both the original and the widened range', () => {
    render(<RepairResult proposal={expanded()} finding={finding()} />);
    expect(screen.getByText(/Expanded from lines 3–3 to 1–5/)).toBeInTheDocument();
  });

  it('explains that the smaller fix could not compile, in the verifier’s own words', () => {
    render(<RepairResult proposal={expanded()} finding={finding()} />);
    expect(screen.getByText(/did not compile on its own/)).toBeInTheDocument();
    // Quoting the verifier keeps the panel and the engine from telling different stories.
    expect(
      screen.getByText(/caused by a declaration outside the code it replaces/),
    ).toBeInTheDocument();
  });

  it('sits inside the status card as a labelled row, like every other fact', () => {
    render(<RepairResult proposal={expanded()} finding={finding()} />);
    // The row label, alongside the rows that were already there.
    expect(screen.getByText('Scope')).toBeInTheDocument();
    expect(screen.getByText('Root cause')).toBeInTheDocument();
    expect(screen.getByText('Verification')).toBeInTheDocument();
  });

  it('is stated even when the widened attempt was itself rejected', () => {
    // The disclosure is not a success notice — a rejected wider patch is exactly when the user most
    // needs to know a larger fix was already tried.
    render(
      <RepairResult
        proposal={expanded({
          verification: {
            verdict: 'regression',
            targetResolved: false,
            newFindingCount: 1,
            syntaxOk: true,
            ran: ['syntax', 'tsc'],
          },
        })}
        finding={finding()}
      />,
    );
    expect(screen.getByText(/Expanded from lines 3–3 to 1–5/)).toBeInTheDocument();
  });

  it('says nothing at all when the scope was never widened', () => {
    render(<RepairResult proposal={proposal()} finding={finding()} />);
    expect(screen.queryByText(/Expanded from lines/)).not.toBeInTheDocument();
    expect(screen.queryByText('Scope')).not.toBeInTheDocument();
  });
});
