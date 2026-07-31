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

describe('RepairResult — the diff is the primary surface', () => {
  it('is ALWAYS mounted, with no toggle needed — hiding it was the regression', () => {
    render(<RepairResult proposal={proposal()} finding={finding()} />);
    expect(screen.getByTestId('diff-editor')).toBeInTheDocument();
    // The old opt-in control is gone: there is nothing to press to see the change.
    expect(screen.queryByRole('button', { name: 'Preview Diff' })).not.toBeInTheDocument();
  });

  it('is shown for a REJECTED patch too — a rejection is exactly when you ask what it tried', () => {
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
    expect(screen.getByTestId('diff-editor')).toBeInTheDocument();
  });

  it('numbers the gutter with REAL file lines, not the slice offset', () => {
    render(
      <RepairResult
        proposal={proposal({
          target: { file: 'src/a.ts', startLine: 120, endLine: 140, symbolName: null },
        })}
        finding={finding()}
      />,
    );
    // Both models hold a slice, so without this Monaco would number a 120-140 repair as "1-21".
    expect(diffProps.current?.['startLine']).toBe(120);
  });

  it('clicking a changed line reveals that REAL line in the editor', () => {
    render(
      <RepairResult
        proposal={proposal({
          target: { file: 'src/a.ts', startLine: 50, endLine: 60, symbolName: null },
        })}
        finding={finding()}
      />,
    );
    const onLineClick = diffProps.current?.['onLineClick'] as (n: number) => void;
    onLineClick(57);
    expect(revealAt).toHaveBeenCalledWith(
      expect.objectContaining({ file: 'src/a.ts', startLine: 57 }),
    );
  });

  it('leaves the view responsive for the scoped modes — two columns do not fit a narrow pane', () => {
    render(<RepairResult proposal={proposal({ mode: 'finding' })} finding={finding()} />);
    expect(diffProps.current?.['sideBySide']).toBeUndefined();
    expect(screen.queryByRole('group', { name: 'Diff view' })).not.toBeInTheDocument();
  });

  it('offers Unified / Side-by-side for whole-file repairs, and switches between them', () => {
    render(
      <RepairResult
        proposal={proposal({
          mode: 'ai-file',
          target: { file: 'src/a.ts', startLine: 1, endLine: 200, symbolName: null },
        })}
        finding={finding()}
      />,
    );
    expect(screen.getByRole('group', { name: 'Diff view' })).toBeInTheDocument();
    expect(diffProps.current?.['sideBySide']).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Unified' }));
    expect(diffProps.current?.['sideBySide']).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Side-by-side' }));
    expect(diffProps.current?.['sideBySide']).toBe(true);
  });
});

describe('RepairResult — long explanations fold', () => {
  it('a short rationale shows in full with no Show more control', () => {
    render(<RepairResult proposal={proposal()} finding={finding()} />);
    expect(screen.getByText('Short reason.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('a long rationale is clamped by default and expands on demand', () => {
    const long = 'x'.repeat(400);
    render(<RepairResult proposal={proposal({ rationale: long })} finding={finding()} />);
    const more = screen.getByRole('button', { name: 'Show more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(long)).not.toBeInTheDocument(); // clamped
    fireEvent.click(more);
    expect(screen.getByText(long)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
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

  it('never replaces the diff — both are present together', () => {
    render(<RepairResult proposal={withSummary} finding={finding()} />);
    expect(screen.getByTestId('diff-editor')).toBeInTheDocument();
    expect(screen.getByText(/Repair summary/i)).toBeInTheDocument();
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

describe('RepairResult — the patch card', () => {
  it('separates mode, scope, lines and impact as distinct labelled facts', () => {
    render(<RepairResult proposal={proposal({ mode: 'finding' })} finding={finding()} />);
    expect(screen.getByText('Repair Finding')).toBeInTheDocument();
    expect(screen.getByText('Scope')).toBeInTheDocument();
    expect(screen.getByText('Selected finding only')).toBeInTheDocument();
    expect(screen.getByText('Lines')).toBeInTheDocument();
    expect(screen.getByText('3–3')).toBeInTheDocument();
    expect(screen.getByText('Validation')).toBeInTheDocument();
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
    expect(screen.getByText('Entire file')).toBeInTheDocument();
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
  it('renders nothing extra when the proposal carries no rootCause (every other mode)', () => {
    render(<RepairResult proposal={proposal({ mode: 'finding' })} finding={finding()} />);
    expect(screen.queryByText('Root cause')).not.toBeInTheDocument();
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
