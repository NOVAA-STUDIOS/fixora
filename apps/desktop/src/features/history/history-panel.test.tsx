import type { RepairHistoryEntry } from '@fixora/shared-types';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/bridge.js', () => ({
  invoke: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

import { invoke } from '../../lib/bridge.js';
import { useAiStore } from '../../stores/ai-store.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { HistoryPanel } from './history-panel.js';
import { useHistoryStore } from './history-store.js';

/**
 * Audit A9 (B1) regression: a Proceed edit has no analyzer Finding behind it — it's recorded with a
 * synthetic `findingId` purely for the audit trail. "Re-run repair" on such a row always resolved
 * to `null` and showed "That finding is no longer available.", which is false. The fix is to never
 * offer that action for a Proceed-sourced entry in the first place.
 */
function entry(overrides: Partial<RepairHistoryEntry> = {}): RepairHistoryEntry {
  return {
    id: 'h1',
    findingId: 'finding-1',
    file: 'src/a.ts',
    symbolName: 'a',
    ruleId: 'no-unused-vars',
    source: 'eslint',
    verdict: 'verified',
    applied: false,
    rationale: 'Removed the unused variable.',
    originalCode: 'const a = 1;',
    repairedCode: 'const a = 2;',
    model: 'test-model',
    confidence: 0.9,
    startLine: 1,
    endLine: 1,
    createdAt: Date.now(),
    appliedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(invoke).mockImplementation((channel: string) => {
    if (channel === 'ai:history') {
      return Promise.resolve({
        ok: true,
        value: { entries: useHistoryStore.getState().entries },
      });
    }
    return Promise.resolve({ ok: true, value: undefined });
  });
  useAiStore.setState({
    config: {
      configured: true,
      model: 'test-model',
      keyHint: '••••1234',
      migratedFrom: null,
      capabilities: null,
      suggestedModel: null,
    },
  });
  useWorkspaceStore.setState({
    workspace: { id: 'ws-1', rootPath: '/ws', name: 'proj', lastOpenedAt: Date.now(), pinnedAt: null },
  });
});

describe('HistoryPanel — Repair vs Proceed entries (Audit A9, B1)', () => {
  it('does not offer "Re-run repair" for a Proceed-sourced entry', async () => {
    const proceedEntry = entry({
      id: 'h-proceed',
      findingId: 'proceed:src/a.ts:1-1',
      ruleId: 'proceed-edit',
      source: 'proceed',
      rationale: 'Made the button green.',
    });
    useHistoryStore.setState({ entries: [proceedEntry], loaded: true });

    render(<HistoryPanel />);
    fireEvent.contextMenu(await screen.findByText('Made the button green.'));

    expect(screen.getByText('Open result')).toBeInTheDocument();
    expect(screen.getByText('Copy repaired code')).toBeInTheDocument();
    expect(screen.queryByText('Re-run repair')).not.toBeInTheDocument();
  });

  it('still offers "Re-run repair" for a real Repair-sourced entry', async () => {
    const repairEntry = entry({
      id: 'h-repair',
      rationale: 'Removed the unused variable.',
    });
    useHistoryStore.setState({ entries: [repairEntry], loaded: true });

    render(<HistoryPanel />);
    fireEvent.contextMenu(await screen.findByText('Removed the unused variable.'));

    expect(screen.getByText('Re-run repair')).toBeInTheDocument();
  });
});
