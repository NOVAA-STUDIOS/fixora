import {
  keyFingerprint,
  providerRegistration,
  resolveCapabilities,
  runWithFailover,
  selectBestModel,
  supportsProfile,
  type AIProvider,
  type CatalogueModel,
  type FailoverAttemptRecord,
  type FailoverAttemptResult,
  type FailoverCandidate,
  type FailoverOutcome,
  type ModelFacts,
  type RoutingTask,
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
  /**
   * Full model listing for a provider, when it exposes one (`discovery: 'catalogue'`). Used ONLY to
   * pick a model for a provider the user left on "auto" — an explicit user model is never replaced.
   */
  modelCatalogue?: (providerId: string) => Promise<readonly CatalogueModel[]>;
  /** Per-model repair-metrics success rate (0–1), for routing's tiebreak. Absent means no history. */
  successRate?: (providerId: string, model: string) => number | null;
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
    task?: RoutingTask,
  ): Promise<{ ok: true; candidates: ResolvedCandidate[] } | { ok: false; reason: ChainRefusal }>;

  /** Walk the chain. Identical failover semantics to the single-provider implementation. */
  run<T>(
    profile: TaskProfile,
    attempt: (candidate: ResolvedCandidate) => Promise<FailoverAttemptResult<T>>,
    options?: {
      signal?: AbortSignal;
      onFailover?: (record: FailoverAttemptRecord<ResolvedCandidate>) => void;
      /** Complexity/size hint for smart model routing on "auto" providers. Optional; safe to omit. */
      task?: RoutingTask;
    },
  ): Promise<OrchestratorOutcome<T>>;
}

/** Either the walk ran (and succeeded or failed), or there was nothing to walk. */
export type OrchestratorOutcome<T> =
  | FailoverOutcome<T, ResolvedCandidate>
  | { readonly ok: false; readonly refused: true; readonly reason: ChainRefusal };

export function createOrchestrator(deps: OrchestratorDeps): Orchestrator {
  async function resolveChain(
    profile: TaskProfile,
    task?: RoutingTask,
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
      /**
       * What the credential STORE just handed back, at the moment the provider is built.
       *
       * Paired with `[provider] request`, this closes the loop on "a saved key was not adopted": if
       * the fingerprint here already matches the newly saved key, the store is correct and any
       * refusal belongs to the provider; if it still shows the old tail, the fault is upstream in the
       * store, not in the adapter. Masked — see `keyFingerprint`.
       */
      console.error('[orchestrator] credential read', {
        provider: settings.id,
        key: keyFingerprint(apiKey),
        auth: descriptor.auth,
      });
      if (descriptor.auth === 'api-key' && apiKey === null) continue;
      sawCredential = true;

      // Smart model routing — ONLY when the user left this provider's model on "auto". An explicit
      // pick (the state migration puts every existing user in, and what a manual choice always
      // produces) is never overridden: "the orchestrator always follows user priority" extends to
      // the user's own model choice, not just provider order.
      let model = settings.model;
      if (task !== undefined && registration.descriptor.discovery === 'catalogue' && deps.registry.modelIsAuto(settings.id)) {
        const catalogue = (await deps.modelCatalogue?.(settings.id)) ?? [];
        const best = selectBestModel(catalogue, task, (id) => deps.successRate?.(settings.id, id) ?? null);
        if (best !== null) model = best.id;
      }

      // Capability gate. A provider that cannot honour a schema would return prose where a patch is
      // expected, and repair writes to source files — so it is excluded here rather than discovered
      // by spending a request and failing the parse.
      const facts = (await deps.modelFacts?.(settings.id, model)) ?? null;
      const resolved = resolveCapabilities(descriptor.capabilities, facts);
      if (!supportsProfile(profile, resolved)) continue;

      candidates.push({
        provider: settings.id,
        model,
        // Carried so failover can tell "this daemon is not running" from "the internet is down".
        // A refused connection to 127.0.0.1 must not stop the walk before the cloud is tried.
        local: descriptor.local,
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
        task?: RoutingTask;
      } = {},
    ): Promise<OrchestratorOutcome<T>> {
      const chain = await resolveChain(profile, options.task);
      if (!chain.ok) return { ok: false, refused: true, reason: chain.reason };

      const [head, ...rest] = chain.candidates;
      // `resolveChain` never returns ok with an empty list; this narrows the tuple the walk needs.
      if (head === undefined) return { ok: false, refused: true, reason: 'none-enabled' };

      return runWithFailover<T, ResolvedCandidate>([head, ...rest], attempt, options);
    },
  };
}
