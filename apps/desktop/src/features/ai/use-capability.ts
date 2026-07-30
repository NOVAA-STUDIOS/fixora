import type { RepairStrategy } from '@fixora/shared-types';

import { useAiStore } from '../../stores/ai-store.js';

/**
 * Whether a task can run on the currently selected model, and why not.
 *
 * Read from the config the main process built from provider metadata — never inferred here, and
 * never from a model id. The UI's job is to *reflect* the capability, not to decide it.
 *
 * The failure this exists to prevent: Repair looked available on every model, and incompatibility
 * was discovered only by pressing it and watching it fail. A control that cannot work must say so
 * before it is pressed.
 */
export type Capability = {
  /** False when the model cannot do this task, or when no key/model is configured yet. */
  readonly enabled: boolean;
  /** One sentence for the tooltip and the inline notice. Empty when enabled. */
  readonly reason: string;
  /** A capable model to switch to, when one exists. */
  readonly suggestion: { id: string; name: string; free: boolean } | null;
};

/**
 * Bug-fix sprint, Phase 1: a `'manual'`-repair finding (its own correct change needs a human
 * judgment call — `repair-eligibility.ts`'s `evaluateRepairEligibility` already refuses it,
 * server-side, before any model call) used to render its Repair button exactly like any other
 * finding's — enabled, no tooltip — because this hook only ever checked MODEL capability, never the
 * finding's own repairability. The user could click it and only then learn, after a round trip,
 * that it was never going to work. `repairability` lets the button say so up front, the same way an
 * incapable model already does.
 */
export function useCapability(
  profile: 'explain' | 'repair' | 'test',
  repairability?: RepairStrategy,
): Capability {
  const config = useAiStore((s) => s.config);

  if (profile === 'repair' && repairability === 'manual') {
    return {
      enabled: false,
      reason:
        'This finding has no automatic or AI fix — the correct change needs your judgment, not a model.',
      // A model switch cannot help here, unlike an incapable-model refusal — never suggest one.
      suggestion: null,
    };
  }

  // No key is a different problem from an incapable model, and the UI already handles it
  // separately ("Set up AI to repair"). Report enabled so this hook does not double up on it.
  if (!config?.configured) {
    return { enabled: true, reason: '', suggestion: null };
  }

  const support = config.capabilities?.profiles[profile];
  // Capabilities unknown (catalogue unreachable). Allow the attempt rather than blocking on a fact
  // we could not check — blocking would turn "you are offline" into "the feature is gone".
  if (support === undefined) return { enabled: true, reason: '', suggestion: null };

  return {
    enabled: support.supported,
    reason: support.supported ? '' : (support.reason ?? 'This model cannot run this task.'),
    suggestion: config.suggestedModel,
  };
}
