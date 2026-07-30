import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAiStore } from '../../stores/ai-store.js';

import { useCapability } from './use-capability.js';

/**
 * Bug-fix sprint, Phase 1: a `'manual'`-repair finding's Repair button used to render exactly like
 * any other finding's — enabled, no tooltip — because this hook only ever checked MODEL capability,
 * never whether the finding itself could be auto-fixed at all. `evaluateRepairEligibility`
 * (main-process) already refused it with a precise reason, but only AFTER a click. These pin that
 * the reason is now available BEFORE the click, exactly like an incapable-model refusal already was.
 */
describe('useCapability', () => {
  beforeEach(() => {
    useAiStore.setState({ config: null });
  });

  it('disables repair for a manual-only finding, with a precise reason and no model suggestion', () => {
    const { result } = renderHook(() => useCapability('repair', 'manual'));
    expect(result.current.enabled).toBe(false);
    expect(result.current.reason).toMatch(/no automatic or AI fix/i);
    expect(result.current.suggestion).toBeNull();
  });

  it('is unaffected by manual-repair status even when AI is not configured yet', () => {
    // "manual" always disables Repair, regardless of what config looks like — it is a property of
    // the finding, not of the model.
    useAiStore.setState({
      config: {
        configured: true,
        model: 'test-model',
        keyHint: null,
        migratedFrom: null,
        capabilities: null,
        suggestedModel: { id: 'better-model', name: 'Better Model', free: true },
      },
    });
    const { result } = renderHook(() => useCapability('repair', 'manual'));
    expect(result.current.enabled).toBe(false);
    expect(result.current.suggestion).toBeNull(); // never suggest a model switch for a manual finding
  });

  it('does not disable explain/test for a manual-repair finding — the manual check is repair-only', () => {
    expect(renderHook(() => useCapability('explain', 'manual')).result.current.enabled).toBe(true);
    expect(renderHook(() => useCapability('test', 'manual')).result.current.enabled).toBe(true);
  });

  it('leaves safe-auto/ai-required findings to the existing model-capability check, unaffected', () => {
    useAiStore.setState({ config: null });
    expect(renderHook(() => useCapability('repair', 'ai-required')).result.current.enabled).toBe(
      true,
    );
    expect(renderHook(() => useCapability('repair', 'safe-auto')).result.current.enabled).toBe(
      true,
    );
    expect(renderHook(() => useCapability('repair')).result.current.enabled).toBe(true);
  });

  it('still reports an incapable model correctly when the finding itself is not manual', () => {
    useAiStore.setState({
      config: {
        configured: true,
        model: 'weak-model',
        keyHint: null,
        migratedFrom: null,
        capabilities: {
          structuredOutput: false,
          contextLength: null,
          profiles: {
            repair: {
              supported: false,
              reason: 'This model cannot produce structured output.',
              basis: 'catalogue',
            },
          },
        },
        suggestedModel: null,
      },
    });
    const { result } = renderHook(() => useCapability('repair', 'ai-required'));
    expect(result.current.enabled).toBe(false);
    expect(result.current.reason).toBe('This model cannot produce structured output.');
  });
});
