import type { ProviderFailure } from './failure.js';
import type { RateLimitFacts } from './rate-limit.js';
/**
 * The provider abstraction (AI-Pipeline §3, ADR-012).
 *
 * One interface, so the pipeline never bakes in a single vendor's assumptions. For the beta the sole
 * transport is OpenRouter (BYOK), which itself fronts OpenAI, Anthropic, and Google — so "others
 * supported by architecture" is true today, through one adapter, not four SDKs. A second native
 * adapter drops in behind this interface for v1.1 without touching the pipeline.
 *
 * Structured output is requested through the provider's native mechanism (JSON-schema mode), never by
 * scraping markdown fences — regex-parsing a model's prose into a patch is silent corruption in a
 * system that writes to people's source files.
 */


export type ProviderRole = 'system' | 'user' | 'assistant';

export interface ProviderMessage {
  readonly role: ProviderRole;
  readonly content: string;
}

export interface ResponseSchema {
  readonly name: string;
  /** A JSON Schema object the model's output must conform to. */
  readonly schema: Record<string, unknown>;
}

export interface ProviderRequest {
  readonly model: string;
  readonly messages: readonly ProviderMessage[];
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  /** When set, the provider is asked to emit output conforming to this schema. */
  readonly responseSchema?: ResponseSchema;
}

export type ProviderEvent =
  | { readonly type: 'text_delta'; readonly text: string }
  | {
      readonly type: 'usage';
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cachedTokens: number;
    }
  | {
      readonly type: 'error';
      readonly retryable: boolean;
      readonly providerCode: string;
      readonly message: string;
      /**
       * The provider's own rate-limit numbers, when the refusal carried them.
       *
       * Unlike the diagnostics below, this IS rendered: it is the difference between "quota
       * exceeded" and "0 of 50 left, back in 6h 52m", and the second is the one a user can act on.
       */
      readonly rateLimit?: RateLimitFacts;
      /**
       * Diagnostics for the developer log only. Never rendered.
       *
       * `requestId` is the provider's correlation id — the one field that turns "a 429 sometimes"
       * into a ticket the provider can actually answer. It was previously discarded at the adapter,
       * so it was unavailable to every layer above.
       */
      readonly status?: number;
      readonly requestId?: string;
    };

export interface ProviderCapabilities {
  readonly structuredOutput: boolean;
  readonly maxContext: number;
}

/**
 * The result of a Test Connection.
 *
 * Deliberately reports each check separately instead of one boolean. "It doesn't work" is the least
 * useful thing a diagnostic can say: a valid key against an unreachable host, and a reachable host
 * rejecting the key, need opposite fixes, and a single red cross sends the user to check the wrong
 * one.
 */
export interface ProviderTestResult {
  /** The host answered at all — separates "no network / wrong URL" from every credential problem. */
  readonly reachable: boolean;
  /** The credential was accepted. Null when the provider needs none (local). */
  readonly authenticated: boolean | null;
  /** The named model exists and is usable. Null when not checked. */
  readonly modelAvailable: boolean | null;
  /** Round-trip time in ms, for the slowest check that ran. */
  readonly latencyMs: number;
  /** Classified failure when something did not pass. Absent on full success. */
  readonly failure?: ProviderFailure;
  /** Models the provider reported, when the check discovered them (Ollama, OpenAI). */
  readonly models?: readonly string[];
}

export interface AIProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
  /**
   * Check reachability, credentials and model availability without running a repair.
   *
   * Every adapter must implement it: a provider that cannot be tested is a provider whose failures
   * can only be discovered by failing a real repair on the user's code, which is precisely the
   * experience this platform exists to remove.
   */
  test(model: string, signal: AbortSignal): Promise<ProviderTestResult>;
}
