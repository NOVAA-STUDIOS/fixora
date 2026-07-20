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

export function useCapability(profile: 'explain' | 'repair' | 'test'): Capability {
  const config = useAiStore((s) => s.config);

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
