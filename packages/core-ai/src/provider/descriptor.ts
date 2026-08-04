import type { ProviderCapabilityMatrix } from './capability.js';
import type { AIProvider } from './types.js';

/**
 * What a provider IS, declared once.
 *
 * This is the whole extension point. Adding a provider to Fixora means writing a descriptor and an
 * adapter and registering the pair — nothing in the orchestrator, the repair pipeline, the verifier
 * or the UI is edited, because none of them contain a provider name. The registry is data, and
 * everything above it iterates.
 *
 * Descriptors are pure data with no I/O, so the whole provider list is available before any network
 * call and before any key is configured — which is what lets Settings render five providers, and lets
 * the orchestrator reason about capability, while offline.
 */

/** How a provider authenticates. Local providers need nothing, and must not be asked for a key. */
export type ProviderAuthKind =
  | 'api-key'
  /** Runs on the user's machine. No credential, and no egress off the device. */
  | 'none';

/** How the model list for a provider is obtained. */
export type ModelDiscovery =
  /** A live HTTP catalogue with capability metadata (OpenRouter). */
  | 'catalogue'
  /** A live list of ids with no capability metadata (OpenAI `/v1/models`). */
  | 'id-list'
  /** A curated list compiled in, because the vendor publishes no machine-readable catalogue. */
  | 'static'
  /** Discovered from the local daemon — reflects what the user has actually pulled. */
  | 'local';

export interface ProviderDescriptor {
  /** Stable id. Used as the credential key and the registry key; never shown to users. */
  readonly id: string;
  /** Shown in Settings and on the provider error card. */
  readonly label: string;
  readonly auth: ProviderAuthKind;
  /** Where a user gets a key. Rendered as a link in Settings; omitted for local providers. */
  readonly keyUrl?: string;
  /**
   * Where the user manages QUOTA and billing — distinct from `keyUrl`.
   *
   * A rate-limited user does not need the key page; they need the page that shows what they have
   * spent and lets them raise the limit. Sending them to the wrong one is a small betrayal of an
   * offer to help. Omitted for local providers, which have no dashboard and no quota.
   */
  readonly dashboardUrl?: string;
  /**
   * Default API base. Overridable per install, which is what makes every OpenAI-compatible endpoint
   * (Azure, Groq, Together, Fireworks, LM Studio, vLLM) reachable without a new adapter — they are
   * this descriptor with a different base URL.
   */
  readonly baseUrl: string;
  /** Used when the user has not chosen a model for this provider. */
  readonly defaultModel: string;
  /** True when inference happens on the user's machine. Drives the privacy notice. */
  readonly local: boolean;
  readonly capabilities: ProviderCapabilityMatrix;
  readonly discovery: ModelDiscovery;
  /** For `static` discovery: the curated ids. */
  readonly models?: readonly string[];
}

/** A descriptor plus the factory that turns it and a credential into a live adapter. */
export interface ProviderRegistration {
  readonly descriptor: ProviderDescriptor;
  /**
   * Build the adapter.
   *
   * `apiKey` is null for local providers. `baseUrl` is the effective base — the descriptor default
   * unless the user overrode it — so an OpenAI-compatible endpoint needs no code at all.
   */
  readonly create: (options: {
    apiKey: string | null;
    baseUrl: string;
    fetchImpl?: typeof fetch;
    appMeta?: { url?: string; name?: string };
  }) => AIProvider;
}
