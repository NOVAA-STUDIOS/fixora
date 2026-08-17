import type { Finding } from '@fixora/shared-types';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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
  ) =>
    selector({ workspace: { id: 'w1', rootPath: '/repo', name: 'repo' }, revealAt, pickAndOpen }),
}));

const { FindingsPanel } = await import('./findings-panel.js');
const { useAiStore } = await import('../../stores/ai-store.js');

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
    if (channel === 'analysis:list')
      return Promise.resolve({ ok: true, value: { findings: state.findings } });
    if (channel === 'analysis:summary') {
      return Promise.resolve({
        ok: true,
        value: state.summary ?? {
          total: 0,
          bySeverity: { error: 0, warning: 0, info: 0 },
          bySource: {},
        },
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
    expect(
      screen.getByText('Showing 1 of 812 problems. Narrow by severity to see the rest.'),
    ).toBeTruthy();
  });

  it('compares against the filtered severity total, not the grand total, when a severity filter is active', () => {
    useFindingsStore.setState({
      findings: [finding({ severity: 'warning' })],
      filter: { severity: 'warning' },
      summary: { total: 900, bySeverity: { error: 5, warning: 600, info: 0 }, bySource: {} },
    });
    render(<FindingsPanel />);
    expect(
      screen.getByText('Showing 1 of 600 problems. Narrow by severity to see the rest.'),
    ).toBeTruthy();
  });
});

describe('FindingsPanel — keyboard operability (beta audit A4)', () => {
  const two: Finding[] = [
    finding({ id: 'f1', message: 'First problem' }),
    finding({
      id: 'f2',
      message: 'Second problem',
      location: { file: 'src/b.ts', startLine: 9, startCol: 1, endLine: 9, endCol: 5 },
    }),
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

    expect(revealAt).toHaveBeenCalledWith({ ...two[1]?.location, severity: two[1]?.severity });
    expect(useFindingsStore.getState().selectedId).toBe('f2');
  });

  it('a mouse click still activates a row directly', async () => {
    useFindingsStore.setState({
      findings: two,
      summary: { total: 2, bySeverity: { error: 2, warning: 0, info: 0 }, bySource: {} },
    });
    render(<FindingsPanel />);
    await userEvent.click(screen.getByText('First problem'));
    expect(revealAt).toHaveBeenCalledWith({ ...two[0]?.location, severity: two[0]?.severity });
    expect(useFindingsStore.getState().selectedId).toBe('f1');
  });
});

/**
 * ISSUE 2/6 regression: "some findings do not show the Repair button".
 *
 * Root cause was visibility, not state: the actions row was `opacity-0` until hover, focus, or
 * selection, so a mouse user who was not hovering saw no Repair button at all. The button must be
 * present and readable at rest, and when it cannot run it must be DISABLED WITH A REASON — never
 * hidden, because a control that vanishes cannot explain itself.
 */
describe('Repair button visibility and the four repair states', () => {
  beforeEach(() => {
    // The three action buttons only render once a key is configured — the not-configured branch
    // deliberately replaces them with "Set up AI to repair". That substitution is intentional and is
    // NOT the reported bug, so these tests exercise the configured case.
    useAiStore.setState({
      config: {
        configured: true,
        model: 'test-model',
        keyHint: null,
        migratedFrom: null,
        capabilities: null,
        suggestedModel: null,
      },
      status: 'idle',
    });
  });

  it('renders Repair at rest, with no hover or selection', async () => {
    useFindingsStore.setState({
      findings: [finding({ repair: 'ai-required' })],
      status: 'done',
    });
    render(<FindingsPanel />);
    const repair = await screen.findByRole('button', { name: 'Repair' });
    expect(repair).toBeInTheDocument();
    expect(repair).toBeEnabled();
  });

  it('a manual-only finding still SHOWS Repair, enabled — the user may attempt it anyway', async () => {
    useFindingsStore.setState({
      findings: [finding({ repair: 'manual' })],
      status: 'done',
    });
    render(<FindingsPanel />);
    const repair = await screen.findByRole('button', { name: 'Repair' });
    expect(repair).toBeEnabled();
    expect(await screen.findByText('Manual')).toBeInTheDocument();
  });

  it('an unsupported file type is a DIFFERENT state with a DIFFERENT reason', async () => {
    useFindingsStore.setState({
      findings: [
        finding({
          repair: 'ai-required',
          location: { file: 'notes.md', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        }),
      ],
      status: 'done',
    });
    render(<FindingsPanel />);
    const repair = await screen.findByRole('button', { name: 'Repair' });
    expect(repair).toBeDisabled();
    expect(repair.getAttribute('title')).toMatch(/file type/i);
    expect(await screen.findByText('Unsupported')).toBeInTheDocument();
  });

  it('every finding exposes exactly one of the four states as a visible label', async () => {
    const cases: [Parameters<typeof finding>[0], string][] = [
      [{ repair: 'safe-auto' }, 'Auto-fix'],
      [{ repair: 'ai-required' }, 'AI fix'],
      [{ repair: 'manual' }, 'Manual'],
      [
        {
          repair: 'ai-required',
          location: { file: 'a.rb', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
        'Unsupported',
      ],
    ];
    for (const [over, label] of cases) {
      useFindingsStore.setState({ findings: [finding(over)], status: 'done' });
      const view = render(<FindingsPanel />);
      expect(await screen.findByText(label)).toBeInTheDocument();
      view.unmount();
    }
  });
});

/**
 * The header's file-type breakdown.
 *
 * The grouping itself is pinned in `finding-category.test.ts`; these cover what only the panel can
 * answer — that it is driven by the same list the rows are, so it can never disagree with what is
 * on screen, and that it stays out of the way when there is nothing to say.
 */
describe('FindingsPanel — file-type breakdown', () => {
  const at = (id: string, file: string) =>
    finding({ id, location: { file, startLine: 1, startCol: 1, endLine: 1, endCol: 1 } });

  it('lists each file type with its count, most problems first', () => {
    useFindingsStore.setState({
      findings: [at('1', 'a.ts'), at('2', 'b.css'), at('3', 'c.ts')],
    });
    render(<FindingsPanel />);
    const items = within(screen.getByLabelText('Problems by file type')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['ts: 2', 'css: 1']);
  });

  it('renders nothing at all when there are no problems', () => {
    render(<FindingsPanel />);
    expect(screen.queryByLabelText('Problems by file type')).toBeNull();
  });

  it('EXCLUDES ignored findings, so it agrees with the rows below it', () => {
    useFindingsStore.setState({
      findings: [at('1', 'a.ts'), at('2', 'b.css'), at('3', 'c.css')],
      ignoredIds: ['2', '3'],
    });
    render(<FindingsPanel />);
    const items = within(screen.getByLabelText('Problems by file type')).getAllByRole('listitem');
    // css is gone entirely rather than showing 0 — both its findings were ignored.
    expect(items.map((li) => li.textContent)).toEqual(['ts: 1']);
  });

  it('re-derives when the findings change — a fixed problem leaves the breakdown', async () => {
    useFindingsStore.setState({ findings: [at('1', 'a.py'), at('2', 'b.py')] });
    render(<FindingsPanel />);
    expect(
      within(screen.getByLabelText('Problems by file type')).getAllByRole('listitem')[0]
        ?.textContent,
    ).toBe('py: 2');

    act(() => {
      useFindingsStore.setState({ findings: [at('1', 'a.py')] });
    });
    await waitFor(() => {
      expect(
        within(screen.getByLabelText('Problems by file type')).getAllByRole('listitem')[0]
          ?.textContent,
      ).toBe('py: 1');
    });
  });

  it('does not push the Re-run control out of the header', () => {
    // Many languages must shorten the list, never displace the one control in the header.
    useFindingsStore.setState({
      findings: ['ts', 'css', 'py', 'html', 'go', 'json', 'rs', 'rb'].map((ext, i) =>
        at(String(i), `f${String(i)}.${ext}`),
      ),
    });
    render(<FindingsPanel />);
    expect(screen.getByRole('button', { name: /Run analysis|Re-run/ })).toBeInTheDocument();
  });
});
