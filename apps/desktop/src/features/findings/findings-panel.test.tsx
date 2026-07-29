import type { Finding } from '@fixora/shared-types';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFindingsStore } from './findings-store.js';

/**
 * Beta audit A4 remediation: a dedicated error state (instead of silently falling through to an
 * empty or stale-looking one), a "Showing N of M" disclosure when the backend's 500-row cap
 * truncates a result set, and real keyboard operability for the findings list (Enter/Space
 * activating the roving-active row, mirroring the file tree's already-fixed pattern).
 *
 * jsdom computes no real layout, so `@tanstack/react-virtual`'s visible-range math (driven by the
 * scroll container's `offsetHeight`) resolves to zero mounted rows unless a height is stubbed —
 * the same workaround `file-tree.test.tsx` uses for the same reason.
 */
const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });
});
afterAll(() => {
  if (originalOffsetHeight) {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
  }
});

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../lib/bridge.js', () => ({ invoke, subscribe: () => () => undefined }));

const revealAt = vi.hoisted(() => vi.fn());
const pickAndOpen = vi.hoisted(() => vi.fn());
vi.mock('../workspace/workspace-store.js', () => ({
  useWorkspaceStore: (
    selector: (s: {
      workspace: { id: string; rootPath: string; name: string } | null;
      revealAt: typeof revealAt;
      pickAndOpen: typeof pickAndOpen;
    }) => unknown,
  ) => selector({ workspace: { id: 'w1', rootPath: '/repo', name: 'repo' }, revealAt, pickAndOpen }),
}));

const { FindingsPanel } = await import('./findings-panel.js');

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    source: 'eslint',
    ruleId: 'no-unused-vars',
    severity: 'error',
    category: 'correctness',
    location: { file: 'src/a.ts', startLine: 3, startCol: 1, endLine: 3, endCol: 10 },
    message: 'Unused variable',
    evidence: { snippet: 'const x = 1;', relatedLocations: [], toolOutput: null },
    fixable: false,
    repair: 'manual',
    confidence: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useFindingsStore.setState({
    findings: [],
    summary: null,
    status: 'idle',
    filter: {},
    error: null,
    ignoredIds: [],
    selectedId: null,
  });
  // The panel refreshes on mount whenever a workspace is open (a real effect, not test-controlled)
  // — echo back whatever the test already put in the store instead of a fixed shape, so that
  // real refresh can never race with / clobber the fixture a test set up before rendering.
  invoke.mockImplementation((channel: string) => {
    const state = useFindingsStore.getState();
    if (channel === 'analysis:list') return Promise.resolve({ ok: true, value: { findings: state.findings } });
    if (channel === 'analysis:summary') {
      return Promise.resolve({
        ok: true,
        value: state.summary ?? { total: 0, bySeverity: { error: 0, warning: 0, info: 0 }, bySource: {} },
      });
    }
    return Promise.resolve({ ok: true, value: undefined });
  });
});

describe('FindingsPanel — error state (beta audit A4)', () => {
  it('shows nothing error-related when status is not "error"', () => {
    render(<FindingsPanel />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the actual failure message, not a silent fallback, when a run errors', () => {
    useFindingsStore.setState({ status: 'error', error: 'eslint exited with code 2' });
    render(<FindingsPanel />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Analysis failed');
    expect(alert.textContent).toContain('eslint exited with code 2');
  });

  it('still shows the error banner even while stale findings from a prior run remain visible', () => {
    useFindingsStore.setState({
      status: 'error',
      error: 'Analysis crashed',
      findings: [finding()],
      summary: { total: 1, bySeverity: { error: 1, warning: 0, info: 0 }, bySource: {} },
    });
    render(<FindingsPanel />);
    expect(screen.getByRole('alert').textContent).toContain('Analysis crashed');
    // The stale finding is still there — this is additive, not a redesign of the list itself.
    expect(screen.getByText('Unused variable')).toBeTruthy();
  });

  it('"Try again" re-runs analysis', async () => {
    useFindingsStore.setState({ status: 'error', error: 'boom' });
    render(<FindingsPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(invoke).toHaveBeenCalledWith('analysis:run', {});
  });
});

describe('FindingsPanel — truncation disclosure (beta audit A4)', () => {
  it('says nothing when the fetched page matches the true total', () => {
    useFindingsStore.setState({
      findings: [finding()],
      summary: { total: 1, bySeverity: { error: 1, warning: 0, info: 0 }, bySource: {} },
    });
    render(<FindingsPanel />);
    expect(screen.queryByText(/showing \d+ of \d+/i)).toBeNull();
  });

  it('discloses the cap when the backend truncated the result set for "All"', () => {
    useFindingsStore.setState({
      findings: [finding()],
      summary: { total: 812, bySeverity: { error: 812, warning: 0, info: 0 }, bySource: {} },
    });
    render(<FindingsPanel />);
    expect(screen.getByText('Showing 1 of 812 problems. Narrow by severity to see the rest.')).toBeTruthy();
  });

  it('compares against the filtered severity total, not the grand total, when a severity filter is active', () => {
    useFindingsStore.setState({
      findings: [finding({ severity: 'warning' })],
      filter: { severity: 'warning' },
      summary: { total: 900, bySeverity: { error: 5, warning: 600, info: 0 }, bySource: {} },
    });
    render(<FindingsPanel />);
    expect(screen.getByText('Showing 1 of 600 problems. Narrow by severity to see the rest.')).toBeTruthy();
  });
});

describe('FindingsPanel — keyboard operability (beta audit A4)', () => {
  const two: Finding[] = [
    finding({ id: 'f1', message: 'First problem' }),
    finding({ id: 'f2', message: 'Second problem', location: { file: 'src/b.ts', startLine: 9, startCol: 1, endLine: 9, endCol: 5 } }),
  ];

  it('rows are not individually tab stops', () => {
    useFindingsStore.setState({
      findings: two,
      summary: { total: 2, bySeverity: { error: 2, warning: 0, info: 0 }, bySource: {} },
    });
    render(<FindingsPanel />);
    expect(screen.getByText('First problem').closest('button')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByText('Second problem').closest('button')).toHaveAttribute('tabindex', '-1');
  });

  it('Enter on the keyboard-active row selects and reveals that finding', async () => {
    useFindingsStore.setState({
      findings: two,
      summary: { total: 2, bySeverity: { error: 2, warning: 0, info: 0 }, bySource: {} },
    });
    render(<FindingsPanel />);
    const list = screen.getByRole('listbox', { name: 'Problems' });
    list.focus();

    await userEvent.keyboard('{ArrowDown}'); // move from f1 to f2
    await userEvent.keyboard('{Enter}');

    expect(revealAt).toHaveBeenCalledWith(two[1]?.location);
    expect(useFindingsStore.getState().selectedId).toBe('f2');
  });

  it('a mouse click still activates a row directly', async () => {
    useFindingsStore.setState({
      findings: two,
      summary: { total: 2, bySeverity: { error: 2, warning: 0, info: 0 }, bySource: {} },
    });
    render(<FindingsPanel />);
    await userEvent.click(screen.getByText('First problem'));
    expect(revealAt).toHaveBeenCalledWith(two[0]?.location);
    expect(useFindingsStore.getState().selectedId).toBe('f1');
  });
});
