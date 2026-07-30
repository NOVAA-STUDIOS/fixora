import { runWithFailover, type AIProvider } from '@fixora/core-ai';

import type {
  Orchestrator,
  OrchestratorOutcome,
  ResolvedCandidate,
} from '../../electron/main/ai/providers/orchestrator.js';

/**
 * An orchestrator over a fixed candidate list, for tests that care about the pipeline rather than
 * about provider selection.
 *
 * Deliberately reuses the real `runWithFailover`: the failover semantics under test — a success ends
 * the walk, a safety rejection is never retried elsewhere — must be the production ones, or the
 * tests would be verifying a second implementation that nothing ships.
 *
 * Selection itself (registry order, credentials, capability filtering) is covered separately against
 * the real orchestrator in `orchestrator.test.ts`.
 */
export function fakeOrchestrator(
  candidates: readonly { provider: string; model: string; adapter: AIProvider }[],
): Orchestrator {
  const resolved: ResolvedCandidate[] = candidates.map((candidate) => ({ ...candidate }));

  return {
    resolveChain: () =>
      Promise.resolve(
        resolved.length === 0
          ? ({ ok: false, reason: 'none-enabled' } as const)
          : ({ ok: true, candidates: resolved } as const),
      ),

    async run(_profile, attempt, options = {}) {
      const [head, ...rest] = resolved;
      if (head === undefined) {
        return { ok: false, refused: true, reason: 'none-enabled' } as OrchestratorOutcome<never>;
      }
      return runWithFailover([head, ...rest], attempt, options);
    },
  };
}

/** The common case: one provider, one model — what every pre-platform test assumed. */
export function singleProvider(adapter: AIProvider, model = 'anthropic/claude-3.5-sonnet'): Orchestrator {
  return fakeOrchestrator([{ provider: 'openrouter', model, adapter }]);
}
