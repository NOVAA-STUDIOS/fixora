import {
  providerRegistration,
  resolveCapabilities,
  runWithFailover,
  supportsProfile,
  type AIProvider,
  type FailoverAttemptRecord,
  type FailoverAttemptResult,
  type FailoverCandidate,
  type FailoverOutcome,
  type ModelFacts,
} from '@fixora/core-ai';
import type { TaskProfile } from '@fixora/shared-types';

import type { CredentialStore } from '../credentials/credential-store.js';

import type { ProviderRegistry } from './provider-registry.js';

/**
 * The AI orchestrator — the single place that decides *who answers*.
 *
 * Everything above it (repair, Proceed) asks for text and gets text. Everything below it (the parser,
 * the verifier, the regression check, the Apply gate) never learns which provider produced that text.
 * That boundary already existed; this file is what keeps it true now that there is more than one
 * provider to choose between.
 *
 * The chain is the user's registry order, filtered to providers that are enabled, have a credential,
 * and can actually do the requested profile. Nothing here contains a provider name — it iterates the
 * catalog — which is what makes "adding a provider is a new adapter and a registration" literally
 * true rather than a design intention.
 *
 * Failover semantics are unchanged from the previous sprint and deliberately so: a candidate that
 * ANSWERS ends the walk, so a patch later rejected by the parser, the verifier or the Apply gate is
 * never re-attempted elsewhere. Shopping a safety rejection around until some provider gets past it
 * is exactly how a safety gate stops being one.
 */

export interface ResolvedCandidate extends FailoverCandidate {
  /** The live adapter for this candidate, already carrying its own credential and base URL. */
  readonly adapter: AIProvider;
}

export interface OrchestratorDeps {
  registry: ProviderRegistry;
  credentials: CredentialStore;
  /** Per-model metadata, where the provider publishes it (OpenRouter). Absent elsewhere. */
  modelFacts?: (providerId: string, model: string) => Promise<ModelFacts | null>;
  appMeta?: { url?: string; name?: string };
}

/** Why no candidate could even be attempted. Distinct from every candidate failing. */
export type ChainRefusal =
  /** No provider is enabled at all. */
  | 'none-enabled'
  /** Providers are enabled, but none has a usable credential. */
  | 'no-credentials'
  /** Providers are configured, but none can do this profile (no schema support, context too small). */
  | 'no-capable-provider';

export interface Orchestrator {
  /**
   * Build the ordered candidate list for a profile.
   *
   * Returns a refusal rather than an empty array, because "nothing to try" has three causes with
   * three different fixes and collapsing them into an empty list would lose that.
   */
  resolveChain(
    profile: TaskProfile,
  ): Promise<{ ok: true; candidates: ResolvedCandidate[] } | { ok: false; reason: ChainRefusal }>;

  /** Walk the chain. Identical failover semantics to the single-provider implementation. */
  run<T>(
    profile: TaskProfile,
    attempt: (candidate: ResolvedCandidate) => Promise<FailoverAttemptResult<T>>,
    options?: { signal?: AbortSignal; onFailover?: (record: FailoverAttemptRecord<ResolvedCandidate>) => void },
  ): Promise<OrchestratorOutcome<T>>;
}

/** Either the walk ran (and succeeded or failed), or there was nothing to walk. */
export type OrchestratorOutcome<T> =
  | FailoverOutcome<T, ResolvedCandidate>
  | { readonly ok: false; readonly refused: true; readonly reason: ChainRefusal };

export function createOrchestrator(deps: OrchestratorDeps): Orchestrator {
  async function resolveChain(
    profile: TaskProfile,
  ): Promise<{ ok: true; candidates: ResolvedCandidate[] } | { ok: false; reason: ChainRefusal }> {
    const enabled = deps.registry.enabled();
    if (enabled.length === 0) return { ok: false, reason: 'none-enabled' };

    const candidates: ResolvedCandidate[] = [];
    let sawCredential = false;

    for (const settings of enabled) {
      const registration = providerRegistration(settings.id);
      if (registration === null) continue; // reconciliation should have removed it; belt and braces
      const { descriptor } = registration;

      // A cloud provider with no key cannot be attempted. A local one needs none — asking a user for
      // an API key to talk to a daemon on their own machine would be nonsense.
      const apiKey = descriptor.auth === 'none' ? null : deps.credentials.getKey(settings.id);
      if (descriptor.auth === 'api-key' && apiKey === null) continue;
      sawCredential = true;

      // Capability gate. A provider that cannot honour a schema would return prose where a patch is
      // expected, and repair writes to source files — so it is excluded here rather than discovered
      // by spending a request and failing the parse.
      const facts = (await deps.modelFacts?.(settings.id, settings.model)) ?? null;
      const resolved = resolveCapabilities(descriptor.capabilities, facts);
      if (!supportsProfile(profile, resolved)) continue;

      candidates.push({
        provider: settings.id,
        model: settings.model,
        adapter: registration.create({
          apiKey,
          baseUrl: settings.baseUrl,
          ...(deps.appMeta === undefined ? {} : { appMeta: deps.appMeta }),
        }),
      });
    }

    if (candidates.length === 0) {
      return { ok: false, reason: sawCredential ? 'no-capable-provider' : 'no-credentials' };
    }
    return { ok: true, candidates };
  }

  return {
    resolveChain,

    async run<T>(
      profile: TaskProfile,
      attempt: (candidate: ResolvedCandidate) => Promise<FailoverAttemptResult<T>>,
      options: {
        signal?: AbortSignal;
        onFailover?: (record: FailoverAttemptRecord<ResolvedCandidate>) => void;
      } = {},
    ): Promise<OrchestratorOutcome<T>> {
      const chain = await resolveChain(profile);
      if (!chain.ok) return { ok: false, refused: true, reason: chain.reason };

      const [head, ...rest] = chain.candidates;
      // `resolveChain` never returns ok with an empty list; this narrows the tuple the walk needs.
      if (head === undefined) return { ok: false, refused: true, reason: 'none-enabled' };

      return runWithFailover<T, ResolvedCandidate>([head, ...rest], attempt, options);
    },
  };
}
