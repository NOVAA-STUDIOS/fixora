import type { AiFailure } from '@fixora/shared-types';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProviderErrorCard } from './provider-error-card.js';

/**
 * The original complaint: "Your OpenRouter quota has been exhausted." — correct, and not enough. The
 * card exists to answer three questions the sentence left open, and these tests are written against
 * those questions rather than against the markup, so a redesign that keeps the answers keeps passing.
 *
 *   1. What happened?          → Reason + Status
 *   2. Fixora, or the provider? → the layer line
 *   3. What do I do now?        → suggested actions, and at least one working button
 */

const ALL_CATEGORIES: AiFailure['category'][] = [
  'quota-exceeded',
  'rate-limited',
  'timeout',
  'invalid-api-key',
  'auth-failed',
  'provider-unavailable',
  'network-offline',
  'model-unavailable',
  'context-too-large',
  'invalid-response',
  'unknown-provider-error',
];

function failure(over: Partial<AiFailure> = {}): AiFailure {
  return {
    category: 'quota-exceeded',
    layer: 'provider',
    actions: ['change-model', 'check-credits'],
    provider: 'OpenRouter',
    model: 'anthropic/claude-3.5-sonnet',
    ...over,
  };
}

function renderCard(over: Partial<AiFailure> | null = {}, props = {}) {
  const onRetry = vi.fn();
  const onOpenSettings = vi.fn();
  render(
    <ProviderErrorCard
      failure={over === null ? null : failure(over)}
      reason="Your provider allowance for this model is used up for now."
      retryable={false}
      onRetry={onRetry}
      onOpenSettings={onOpenSettings}
      {...props}
    />,
  );
  return { onRetry, onOpenSettings };
}

describe('ProviderErrorCard — what happened', () => {
  it('states the reason, the provider, the model and the status', () => {
    renderCard();
    const card = screen.getByRole('alert');
    expect(card).toHaveTextContent('AI Repair Unavailable');
    expect(card).toHaveTextContent('Your provider allowance for this model is used up');
    expect(card).toHaveTextContent('OpenRouter');
    expect(card).toHaveTextContent('anthropic/claude-3.5-sonnet');
    expect(card).toHaveTextContent('Quota exceeded');
  });

  it('has a readable status label for every category — no raw enum leaks to the user', () => {
    for (const category of ALL_CATEGORIES) {
      const { unmount } = render(
        <ProviderErrorCard
          failure={failure({ category })}
          reason="Something failed."
          retryable={false}
          onRetry={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      );
      // The kebab-case enum value must never appear; a human label must.
      expect(screen.getByRole('alert').textContent, category).not.toContain(category);
      unmount();
    }
  });

  it('never renders a stack trace, status code, or request id', () => {
    renderCard(
      {},
      {
        reason:
          'The provider is having trouble right now. This is on their side, not Fixora’s — try again shortly.',
      },
    );
    const text = screen.getByRole('alert').textContent;
    expect(text).not.toMatch(/HTTP[_ ]?\d{3}/);
    expect(text).not.toMatch(/\bat .+:\d+:\d+/); // stack frame
    expect(text).not.toMatch(/req_[A-Za-z0-9]/); // request id
    // It does say where the detail went, so a bug reporter knows a trace exists.
    expect(text).toContain('developer log');
  });
});

describe('ProviderErrorCard — whose problem is it', () => {
  /**
   * The requirement this was built for: never blame the Repair Engine for a provider issue. A user
   * who reads a 503 as a Fixora defect files the wrong bug and loses trust in the engine.
   */
  it('names the AI provider, explicitly not Fixora, for a provider-side failure', () => {
    renderCard({ layer: 'provider', category: 'provider-unavailable' });
    expect(screen.getByRole('alert')).toHaveTextContent('AI provider — not Fixora');
  });

  it('names the user’s configuration for a key or credit problem', () => {
    renderCard({ layer: 'configuration', category: 'invalid-api-key', actions: ['open-settings'] });
    expect(screen.getByRole('alert')).toHaveTextContent('Your Fixora configuration');
  });
});

describe('ProviderErrorCard — what do I do now', () => {
  it('lists the suggested actions in the order the classifier ranked them', () => {
    renderCard({ actions: ['change-model', 'check-credits', 'retry-later'] });
    const items = within(screen.getByRole('alert')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'Select another configured model',
      'Check your API credits with the provider',
      'Try again in a few minutes',
    ]);
  });

  /**
   * The invariant that makes this feature worth having. Rendered across the whole category set,
   * because a dead end is exactly the kind of thing that appears only for the one case nobody
   * thought to write a test for.
   */
  it('always offers at least one action button, for every category', () => {
    for (const category of ALL_CATEGORIES) {
      const { unmount } = render(
        <ProviderErrorCard
          failure={failure({ category, actions: ['change-model'] })}
          reason="Something failed."
          retryable={false}
          onRetry={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      );
      expect(within(screen.getByRole('alert')).getAllByRole('button').length, category).toBeGreaterThan(
        0,
      );
      unmount();
    }
  });

  it('offers Retry only when a retry could succeed', () => {
    renderCard({ actions: ['change-model', 'check-credits'] }); // quota — retrying cannot help
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('offers Retry when the failure is retryable', () => {
    renderCard({ category: 'rate-limited', actions: ['retry', 'change-model'] }, { retryable: true });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('labels the settings button Change Model when that is the actual advice', () => {
    renderCard({ category: 'model-unavailable', actions: ['change-model'] });
    expect(screen.getByRole('button', { name: 'Change Model' })).toBeInTheDocument();
  });

  it('wires the buttons to their handlers', () => {
    const { onRetry, onOpenSettings } = renderCard(
      { category: 'rate-limited', actions: ['retry', 'open-settings'] },
      { retryable: true },
    );
    screen.getByRole('button', { name: 'Retry' }).click();
    screen.getByRole('button', { name: 'Open Settings' }).click();
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});

describe('ProviderErrorCard — the reduced form', () => {
  /**
   * Not every failure reaches the classifier: an IPC drop between renderer and main has no provider
   * and no status. That path used to render a bare sentence, which is the empty-panel case the
   * requirements rule out. It degrades to a card without the provider rows — never to nothing.
   */
  it('renders a usable card with no classification at all', () => {
    renderCard(null, { retryable: true });
    const card = screen.getByRole('alert');
    expect(card).toHaveTextContent('AI Repair Unavailable');
    expect(card).toHaveTextContent('Your provider allowance');
    expect(within(card).getAllByRole('button').length).toBeGreaterThan(0);
    // No provider/model/status rows are invented for a failure we could not classify.
    expect(card).not.toHaveTextContent('OpenRouter');
  });
});

describe('ProviderErrorCard — severity styling', () => {
  it('uses danger styling for configuration and authentication failures', () => {
    renderCard({ layer: 'configuration', category: 'invalid-api-key', actions: ['open-settings'] });
    expect(screen.getByRole('alert').className).toContain('danger');
  });

  it('uses warning styling for a failure that may clear on its own', () => {
    renderCard({ layer: 'provider', category: 'rate-limited', actions: ['retry'] });
    expect(screen.getByRole('alert').className).toContain('warn');
  });
});
