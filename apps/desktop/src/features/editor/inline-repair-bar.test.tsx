import type { AiProposal, VerificationReport } from '@fixora/shared-types';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/bridge.js', () => ({
  invoke: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
  subscribe: () => () => undefined,
}));

import { useAiStore } from '../../stores/ai-store.js';
import { useUiStore } from '../../stores/ui-store.js';

import { InlineRepairBar } from './inline-repair-bar.js';

/**
 * The inline review controls.
 *
 * This bar is where Accept and Reject now live, so the thing that most needs pinning is that moving
 * them did NOT move the decision: `enabled` still comes from `evaluateApplyGate` reading the same
 * verification report, and Accept still calls the same store action that goes through the same
 * guarded apply channel. A repair the verifier rejected must be exactly as unappliable here as it
 * was in the panel.
 */
function report(over: Partial<VerificationReport> = {}): VerificationReport {
  return {
    verdict: 'verified',
    targetResolved: true,
    newFindingCount: 0,
    syntaxOk: true,
    ran: ['syntax', 'tsc'],
    ...over,
  };
}

function repairProposal(verification: VerificationReport): Extract<AiProposal, { profile: 'repair' }> {
  return {
    profile: 'repair',
    historyId: 'h1',
    repairedCode: 'const a = 1;',
    originalCode: 'const a = 2;',
    rationale: 'r',
    confidence: 0.9,
    target: { file: 'src/a.ts', startLine: 3, endLine: 3, symbolName: null },
    verification,
  };
}

beforeEach(() => {
  useAiStore.setState({ proposal: repairProposal(report()) });
  useUiStore.getState().closeFullDiff();
});

describe('InlineRepairBar — the decision did not move, only the buttons did', () => {
  it('enables Accept for a verified repair', () => {
    render(<InlineRepairBar position={{ index: 0, total: 1 }} onNext={() => {}} onPrevious={() => {}} />);
    expect(screen.getByRole('button', { name: 'Accept' })).not.toBeDisabled();
  });

  it('disables Accept for a regression, and says why on hover', () => {
    useAiStore.setState({
      proposal: repairProposal(report({ verdict: 'regression', newFindingCount: 1 })),
    });
    render(<InlineRepairBar position={{ index: 0, total: 1 }} onNext={() => {}} onPrevious={() => {}} />);
    const accept = screen.getByRole('button', { name: 'Accept' });
    expect(accept).toBeDisabled();
    expect(accept.getAttribute('title')).toMatch(/Apply is disabled/i);
  });

  it('disables Accept when the patched file does not parse', () => {
    useAiStore.setState({
      proposal: repairProposal(report({ verdict: 'regression', syntaxOk: false })),
    });
    render(<InlineRepairBar position={{ index: 0, total: 1 }} onNext={() => {}} onPrevious={() => {}} />);
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
  });

  it('Accept calls the same applyRepair the panel button called', () => {
    const applyRepair = vi.fn(() => Promise.resolve(true));
    useAiStore.setState({ applyRepair });
    render(<InlineRepairBar position={{ index: 0, total: 1 }} onNext={() => {}} onPrevious={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(applyRepair).toHaveBeenCalledTimes(1);
  });

  it('Reject dismisses the proposal rather than writing anything', () => {
    const dismiss = vi.fn();
    const applyRepair = vi.fn(() => Promise.resolve(true));
    useAiStore.setState({ dismiss, applyRepair });
    render(<InlineRepairBar position={{ index: 0, total: 1 }} onNext={() => {}} onPrevious={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(applyRepair).not.toHaveBeenCalled();
  });
});

describe('InlineRepairBar — navigation', () => {
  it('shows position and offers navigation when there is more than one edit', () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    render(<InlineRepairBar position={{ index: 1, total: 3 }} onNext={onNext} onPrevious={onPrevious} />);
    expect(screen.getByText('2/3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous edit' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it('hides navigation for a single edit — there is nowhere to go', () => {
    render(<InlineRepairBar position={{ index: 0, total: 1 }} onNext={() => {}} onPrevious={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Next edit' })).not.toBeInTheDocument();
  });
});

describe('InlineRepairBar — full diff escape hatch', () => {
  it('opens the traditional side-by-side view on demand', () => {
    render(<InlineRepairBar position={{ index: 0, total: 1 }} onNext={() => {}} onPrevious={() => {}} />);
    expect(useUiStore.getState().fullDiffOpen).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Open Full Diff' }));
    expect(useUiStore.getState().fullDiffOpen).toBe(true);
  });
});
