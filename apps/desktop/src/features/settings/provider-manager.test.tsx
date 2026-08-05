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
    keyHint: '••••5fcw',
    local: false,
    health: null,
    ...over,
  };
}

const THREE: ProviderInfo[] = [
  provider(),
  // No key stored, so no hint — main never returns a hint without a key.
  provider({
    id: 'openai',
    label: 'OpenAI',
    enabled: false,
    priority: 2,
    hasKey: false,
    keyHint: null,
  }),
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

/**
 * Per-provider key entry.
 *
 * One shared field labelled for a single vendor is what made every provider after the first
 * unusable. These pin that each provider owns its own field, that saving names the right id, and
 * that key material never appears in the DOM.
 */
describe('ProviderManager — per-provider key fields', () => {
  it('gives every key-requiring provider its own field, and none to a local one', async () => {
    render(<ProviderManager />);
    await screen.findAllByRole('listitem');
    // OpenRouter and OpenAI need keys; Ollama does not.
    expect(screen.getByLabelText('OpenRouter API key')).toBeInTheDocument();
    expect(screen.getByLabelText('OpenAI API key')).toBeInTheDocument();
    expect(screen.queryByLabelText('Ollama (local) API key')).not.toBeInTheDocument();
  });

  it('saves to the provider whose field was used — the whole bug', async () => {
    render(<ProviderManager />);
    await screen.findAllByRole('listitem');
    const field = screen.getByLabelText('OpenAI API key');
    fireEvent.change(field, { target: { value: 'sk-openai-key' } });
    const row = within(screen.getAllByRole('listitem')[1] as HTMLElement);
    fireEvent.click(row.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('providers:setKey', {
        id: 'openai',
        key: 'sk-openai-key',
      });
    });
    // And never to another provider's slot.
    expect(invoke).not.toHaveBeenCalledWith('providers:setKey', expect.objectContaining({ id: 'openrouter' }));
  });

  it('shows the masked hint for a stored key, and a prompt when there is none', async () => {
    render(<ProviderManager />);
    await screen.findAllByRole('listitem');
    // Two keys for the same provider look identical to a checkmark; the tail tells them apart.
    expect(screen.getByLabelText('OpenRouter API key')).toHaveAttribute('placeholder', '••••5fcw');
    expect(screen.getByLabelText('OpenAI API key')).toHaveAttribute(
      'placeholder',
      'OpenAI API key',
    );
  });

  it('offers Remove only where a key is stored', async () => {
    render(<ProviderManager />);
    await screen.findAllByRole('listitem');
    const withKey = within(screen.getAllByRole('listitem')[0] as HTMLElement);
    const without = within(screen.getAllByRole('listitem')[1] as HTMLElement);
    expect(withKey.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(without.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('clearing names the right provider', async () => {
    render(<ProviderManager />);
    await screen.findAllByRole('listitem');
    const row = within(screen.getAllByRole('listitem')[0] as HTMLElement);
    fireEvent.click(row.getByRole('button', { name: 'Remove' }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('providers:clearKey', { id: 'openrouter' });
    });
  });

  it('masks the input and never leaves the typed key in the DOM after saving', async () => {
    render(<ProviderManager />);
    await screen.findAllByRole('listitem');
    const field = screen.getByLabelText<HTMLInputElement>('OpenAI API key');
    expect(field.type).toBe('password');
    fireEvent.change(field, { target: { value: 'sk-should-not-persist' } });
    const row = within(screen.getAllByRole('listitem')[1] as HTMLElement);
    fireEvent.click(row.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(field.value).toBe('');
    });
    expect(document.body.innerHTML).not.toContain('sk-should-not-persist');
  });

  it('keeps what was typed when the save FAILS, rather than losing it', async () => {
    render(<ProviderManager />);
    await screen.findAllByRole('listitem');
    const field = screen.getByLabelText<HTMLInputElement>('OpenAI API key');
    fireEvent.change(field, { target: { value: 'sk-typed' } });
    invoke.mockResolvedValue({ ok: false, error: { message: 'Keychain unavailable.' } });
    const row = within(screen.getAllByRole('listitem')[1] as HTMLElement);
    fireEvent.click(row.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Keychain unavailable.');
    expect(field.value).toBe('sk-typed');
  });

  it('will not save an empty field', async () => {
    render(<ProviderManager />);
    await screen.findAllByRole('listitem');
    const row = within(screen.getAllByRole('listitem')[1] as HTMLElement);
    expect(row.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

/**
 * The model field.
 *
 * `providers:setModel` existed, persisted correctly, and had NO caller in the renderer — the row
 * printed the model as text. The only model control in Settings wrote the legacy store the chain does
 * not read, so a change appeared to save and the next repair used the old model.
 */
describe('ProviderManager — model field', () => {
  it('sends the change to providers:setModel, naming the right provider', async () => {
    render(<ProviderManager />);
    await screen.findAllByRole('listitem');
    const row = within(screen.getAllByRole('listitem')[1] as HTMLElement);
    fireEvent.change(screen.getByLabelText('OpenAI model'), { target: { value: 'gpt-4.1' } });
    fireEvent.click(row.getByRole('button', { name: 'Set model' }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('providers:setModel', { id: 'openai', model: 'gpt-4.1' });
    });
  });

  it('shows the model main returned, per provider', async () => {
    render(<ProviderManager />);
    await screen.findAllByRole('listitem');
    expect(screen.getByLabelText('OpenRouter model')).toHaveValue('gpt-oss-20b:free');
    expect(screen.getByLabelText('OpenAI model')).toHaveValue('gpt-oss-20b:free');
  });

  it('an AUTO model shows as an empty field over a placeholder', async () => {
    // Empty is the honest rendering of "following the default": it makes clearing the field the way
    // back to that default, rather than the user having to guess a magic value.
    invoke.mockResolvedValue(listOk([provider({ modelIsAuto: true, model: 'gemini-2.0-flash' })]));
    render(<ProviderManager />);
    await screen.findAllByRole('listitem');
    const input = screen.getByLabelText('OpenRouter model');
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', 'gemini-2.0-flash');
  });

  it('will not save until something actually changed', async () => {
    render(<ProviderManager />);
    await screen.findAllByRole('listitem');
    const row = within(screen.getAllByRole('listitem')[0] as HTMLElement);
    expect(row.getByRole('button', { name: 'Set model' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('OpenRouter model'), { target: { value: 'other' } });
    expect(row.getByRole('button', { name: 'Set model' })).toBeEnabled();
  });

  it('an empty value is sent as empty — that is how a user returns to the default', async () => {
    render(<ProviderManager />);
    await screen.findAllByRole('listitem');
    const row = within(screen.getAllByRole('listitem')[0] as HTMLElement);
    fireEvent.change(screen.getByLabelText('OpenRouter model'), { target: { value: '' } });
    fireEvent.click(row.getByRole('button', { name: 'Set model' }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('providers:setModel', { id: 'openrouter', model: '' });
    });
  });
});
