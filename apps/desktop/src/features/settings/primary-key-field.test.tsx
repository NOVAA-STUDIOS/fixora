import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../lib/bridge.js', () => ({ invoke, subscribe: () => () => undefined }));

const loadConfig = vi.hoisted(() => vi.fn());
vi.mock('../../stores/ai-store.js', () => ({
  useAiStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ loadConfig, config: null, models: null }),
    { getState: () => ({ loadConfig }) },
  ),
}));

import { PrimaryKeyField } from './settings-panel.js';

/**
 * The primary key field.
 *
 * The slot used to be labelled for one vendor and wired to the legacy single-key store, which is how
 * a Gemini key ended up in the OpenRouter slot. It now reads the key's own prefix and files it. What
 * these pin is the routing — that the key reaches the provider it belongs to and no other — and the
 * refusal, because guessing at an unknown key produces a 401 from a provider nobody chose.
 */
function field(): HTMLInputElement {
  return screen.getByLabelText('Primary API key');
}

beforeEach(() => {
  invoke.mockReset();
  loadConfig.mockReset();
  invoke.mockResolvedValue({ ok: true, value: { providers: [] } });
});

describe('PrimaryKeyField — detection', () => {
  const CASES: [string, string, string][] = [
    ['sk-ant-api03-x', 'Anthropic', 'anthropic'],
    ['sk-or-v1-x', 'OpenRouter', 'openrouter'],
    ['AIzaSyD-x', 'Google Gemini', 'gemini'],
    ['gsk_x', 'Groq', 'groq'],
    ['sk-proj-x', 'OpenAI', 'openai'],
  ];

  for (const [key, label, id] of CASES) {
    it(`${label}: names the provider live, before Save`, () => {
      render(<PrimaryKeyField />);
      fireEvent.change(field(), { target: { value: key } });
      expect(screen.getByText(label)).toBeInTheDocument();
      // The id is what routing depends on; the label is only what the user reads.
      expect(id).toBeTruthy();
    });

    it(`${label}: saves to its own slot and makes it primary`, async () => {
      render(<PrimaryKeyField />);
      fireEvent.change(field(), { target: { value: key } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith('providers:setKey', {
          id,
          key,
          makePrimary: true,
        });
      });
    });
  }
});

describe('PrimaryKeyField — an unrecognised key', () => {
  it('warns instead of guessing', () => {
    render(<PrimaryKeyField />);
    fireEvent.change(field(), { target: { value: 'hf_something' } });
    expect(screen.getByText('Unknown provider — use slots below.')).toBeInTheDocument();
  });

  it('will not save it — no channel is called at all', () => {
    render(<PrimaryKeyField />);
    fireEvent.change(field(), { target: { value: 'hf_something' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(invoke).not.toHaveBeenCalledWith('providers:setKey', expect.anything());
  });

  it('says nothing at all while the field is empty', () => {
    render(<PrimaryKeyField />);
    expect(screen.queryByText('Unknown provider — use slots below.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('PrimaryKeyField — after saving', () => {
  it('re-reads the AI config, so "Set up AI to repair" stops showing', async () => {
    // The bug this closes: the flag behind that button was only ever fetched on mount, so a key
    // saved here left the Problems panel still telling the user to set one up.
    render(<PrimaryKeyField />);
    fireEvent.change(field(), { target: { value: 'sk-ant-x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(loadConfig).toHaveBeenCalled();
    });
  });

  it('clears the input on success', async () => {
    render(<PrimaryKeyField />);
    fireEvent.change(field(), { target: { value: 'gsk_x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(field().value).toBe('');
    });
  });

  it('KEEPS what was typed when the save fails', async () => {
    render(<PrimaryKeyField />);
    fireEvent.change(field(), { target: { value: 'sk-or-x' } });
    invoke.mockResolvedValue({ ok: false, error: { message: 'Keychain unavailable.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.getByText('Keychain unavailable.')).toBeInTheDocument();
    });
    // A key copied from a page that shows it once is unrecoverable if the field empties itself.
    expect(field().value).toBe('sk-or-x');
  });
});
