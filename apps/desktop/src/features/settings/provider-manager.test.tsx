import type { ProviderInfo } from '@fixora/shared-types';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../lib/bridge.js', () => ({ invoke, subscribe: () => () => undefined }));

import { ProviderManager } from './provider-manager.js';

/**
 * The provider panel — the surface that makes the registry reachable.
 *
 * The properties worth pinning are about AUTHORITY and HONESTY: the order shown is the one main
 * returned (never one the renderer recomputed), and a provider nobody has exercised says so rather
 * than being coloured as unhealthy.
 */
function provider(over: Partial<ProviderInfo> = {}): ProviderInfo {
  return {
    id: 'openrouter',
    label: 'OpenRouter',
    enabled: true,
    priority: 1,
    model: 'gpt-oss-20b:free',
    modelIsAuto: false,
    baseUrl: 'https://openrouter.ai/api/v1',
    requiresKey: true,
    hasKey: true,
    local: false,
    health: null,
    ...over,
  };
}

const THREE: ProviderInfo[] = [
  provider(),
  provider({ id: 'openai', label: 'OpenAI', enabled: false, priority: 2, hasKey: false }),
  provider({
    id: 'ollama',
    label: 'Ollama (local)',
    enabled: false,
    priority: 3,
    requiresKey: false,
    hasKey: true,
    local: true,
  }),
];

function listOk(providers: ProviderInfo[]) {
  return { ok: true as const, value: { providers } };
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(listOk(THREE));
});

describe('ProviderManager — lists the chain in priority order', () => {
  it('renders every provider, numbered, top first', async () => {
    render(<ProviderManager />);
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain('OpenRouter');
    expect(items[2]?.textContent).toContain('Ollama (local)');
  });

  it('marks a local provider, and flags an enabled provider with no key', async () => {
    // An enabled provider with no credential is silently skipped by the chain — say so.
    render(<ProviderManager />);
    expect(await screen.findByText('local')).toBeInTheDocument();
    expect(screen.getByText('no key')).toBeInTheDocument();
  });

  it('says "not checked yet" rather than colouring an unused provider as unhealthy', async () => {
    render(<ProviderManager />);
    expect((await screen.findAllByText('not checked yet')).length).toBeGreaterThan(0);
  });

  it('shows health facts when they exist', async () => {
    invoke.mockResolvedValue(
      listOk([
        provider({
          health: {
            providerId: 'openrouter',
            label: 'OpenRouter',
            enabled: true,
            status: 'rate-limited',
            model: 'm',
            latencyMs: 412,
            lastSuccessAt: null,
            lastFailureAt: null,
            lastFailureCategory: null,
            quotaRemaining: 0,
            quotaLimit: 50,
            quotaResetAt: null,
            checkedAt: 1,
          },
        }),
      ]),
    );
    render(<ProviderManager />);
    expect(await screen.findByText('Rate Limited')).toBeInTheDocument();
    expect(screen.getByText('412ms')).toBeInTheDocument();
    expect(screen.getByText(/0\/50 left/)).toBeInTheDocument();
  });
});

describe('ProviderManager — main owns the order', () => {
  it('reorders from the RESPONSE, not from local state', async () => {
    render(<ProviderManager />);
    await screen.findAllByRole('listitem');

    const reordered = [
      provider({ id: 'openai', label: 'OpenAI', priority: 1 }),
      provider({ priority: 2 }),
      THREE[2] as ProviderInfo,
    ];
    invoke.mockResolvedValue(listOk(reordered));
    fireEvent.click(screen.getByRole('button', { name: 'Move OpenAI up' }));

    await waitFor(() => {
      expect(screen.getAllByRole('listitem')[0]?.textContent).toContain('OpenAI');
    });
    expect(invoke).toHaveBeenCalledWith('providers:moveUp', { id: 'openai' });
  });

  it('disables Move Up at the top and Move Down at the bottom', async () => {
    render(<ProviderManager />);
    await screen.findAllByRole('listitem');
    expect(screen.getByRole('button', { name: 'Move OpenRouter up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Ollama (local) down' })).toBeDisabled();
  });

  it('toggling enable sends the change to main', async () => {
    render(<ProviderManager />);
    await screen.findAllByRole('listitem');
    const row = within(screen.getAllByRole('listitem')[1] as HTMLElement);
    fireEvent.click(row.getByRole('switch', { name: 'Enable OpenAI' }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('providers:setEnabled', { id: 'openai', enabled: true });
    });
  });

  it('surfaces a failed write instead of showing a change that did not happen', async () => {
    render(<ProviderManager />);
    await screen.findAllByRole('listitem');
    invoke.mockResolvedValue({ ok: false, error: { message: 'Could not write provider settings.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move OpenAI up' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not write provider settings.');
    // And the order is untouched.
    expect(screen.getAllByRole('listitem')[0]?.textContent).toContain('OpenRouter');
  });

  it('never renders anything resembling a credential', async () => {
    render(<ProviderManager />);
    await screen.findAllByRole('listitem');
    expect(document.body.textContent).not.toMatch(/sk-/);
  });
});
