import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAiStore } from '../../stores/ai-store.js';

import { useCapability } from './use-capability.js';

/**
 * `repairability: 'manual'` used to hard-disable Repair regardless of model capability — a
 * stronger claim than "no fix was proposed" that the user could not override. Repair must work
 * for every finding type the model itself can attempt, so `useCapability` no longer special-cases
 * `'manual'` at all; these pin that it now falls through to the same model-capability check every
 * other repairability value already gets.
 */
describe('useCapability', () => {
  beforeEach(() => {
    useAiStore.setState({ config: null });
  });

  it('does not disable repair for a manual finding when no model is configured yet', () => {
    const { result } = renderHook(() => useCapability('repair', 'manual'));
    expect(result.current.enabled).toBe(true);
  });

  it('leaves a manual finding to the same model-capability check as any other repairability', () => {
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
    const manual = renderHook(() => useCapability('repair', 'manual')).result.current;
    const aiRequired = renderHook(() => useCapability('repair', 'ai-required')).result.current;
    // Same model, same profile — a manual finding gets no special treatment either way.
    expect(manual).toEqual(aiRequired);
    expect(manual.enabled).toBe(false);
    expect(manual.reason).toBe('This model cannot produce structured output.');
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
