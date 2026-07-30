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

export interface AIProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
}
