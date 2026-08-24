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
    provider: null,
    attempts: [],
    verifyAttempts: [],
    confidence: 0.9,
    startLine: 1,
    endLine: 1,
    createdAt: Date.now(),
    appliedAt: null,
    wasForced: false,
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

describe('HistoryPanel — Provider History', () => {
  it('shows the final provider and model for an AI repair', async () => {
    const withProvider = entry({
      id: 'h-provider',
      rationale: 'Fixed the type error.',
      provider: 'openai',
      model: 'gpt-4.1-mini',
    });
    useHistoryStore.setState({ entries: [withProvider], loaded: true });

    render(<HistoryPanel />);
    await screen.findByText('Fixed the type error.');
    expect(screen.getByText('openai · gpt-4.1-mini')).toBeInTheDocument();
  });

  it('shows a retry badge only when a provider was actually tried and failed first', async () => {
    const retried = entry({
      id: 'h-retried',
      rationale: 'Recovered after a quota failure.',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      attempts: [
        { provider: 'openrouter', model: 'openai/gpt-oss-20b:free', category: 'quota-exceeded' },
      ],
    });
    useHistoryStore.setState({ entries: [retried], loaded: true });

    render(<HistoryPanel />);
    await screen.findByText('Recovered after a quota failure.');
    expect(screen.getByText('retried 1×')).toBeInTheDocument();
  });

  it('omits the provider line entirely for a deterministic repair with no provider', async () => {
    const noProvider = entry({
      id: 'h-none',
      rationale: 'Removed an unused import.',
      provider: null,
      attempts: [],
    });
    useHistoryStore.setState({ entries: [noProvider], loaded: true });

    render(<HistoryPanel />);
    await screen.findByText('Removed an unused import.');
    // Nothing fabricated for a repair that never touched a provider — no "· undefined", no badge.
    expect(screen.queryByText(/retried/)).not.toBeInTheDocument();
  });
});
