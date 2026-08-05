import type { ProviderCapabilityMatrix } from '../capability.js';
import type { ProviderDescriptor, ProviderRegistration } from '../descriptor.js';
import { readRateLimit } from '../rate-limit.js';
import type {
  AIProvider,
  ProviderEvent,
  ProviderRequest,
  ProviderTestResult,
} from '../types.js';

import { keyFingerprint, type FetchLike } from './openai-compatible.js';
import { readSseStream, sseData } from './sse.js';

/**
 * Anthropic (Claude), via the Messages API.
 *
 * The first adapter that is NOT OpenAI-compatible, and the reason the platform needed a second wire
 * implementation rather than a third descriptor. Four differences, all structural:
 *
 *  1. **`system` is a top-level field, not a message role.** Anthropic rejects `role: 'system'`
 *     outright, and Fixora's repair prompt is built as a system + user pair — so the split happens
 *     here rather than being pushed onto the prompt builder, which would make the prompt
 *     provider-aware and undo the whole point of the abstraction.
 *  2. **`max_tokens` is REQUIRED.** Omitting it is a 400. Fixora's budget is optional, so a
 *     conservative default is supplied when the caller has none.
 *  3. **Typed SSE frames.** Text arrives as `content_block_delta` with a nested `text_delta`, not
 *     as `choices[].delta.content`; usage arrives split across `message_start` (input) and
 *     `message_delta` (output), so both are accumulated.
 *  4. **`x-api-key` + `anthropic-version`**, not a bearer token. The version header is mandatory.
 *
 * Everything ABOVE this file is unchanged: it emits the same `ProviderEvent` stream as every other
 * adapter, so `ai-service.ts` cannot tell which provider answered.
 */

const BASE_URL = 'https://api.anthropic.com/v1';

/**
 * The Messages API version. Anthropic requires this header on every request and uses it to pin wire
 * behaviour, so it is a compatibility contract rather than a detail — pinned, not floating.
 */
const API_VERSION = '2023-06-01';

/** Anthropic requires max_tokens. Used only when the caller supplied no budget of its own. */
const DEFAULT_MAX_TOKENS = 4096;

const CAPABILITIES: ProviderCapabilityMatrix = {
  streaming: 'yes',
  // Claude has no `response_format`. JSON is obtained by instruction, which the repair parser and
  // the verifier already cope with — but claiming schema enforcement we cannot deliver would let
  // the capability gate admit a path that fails at parse time instead of at selection time.
  json: 'per-model',
  reasoning: 'per-model',
  images: 'per-model',
  functionCalling: 'yes',
  largeContext: 'yes',
  jsonStrategy: 'none',
  typicalContext: 200_000,
};

export const anthropicDescriptor: ProviderDescriptor = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  auth: 'api-key',
  keyUrl: 'https://console.anthropic.com/settings/keys',
  dashboardUrl: 'https://console.anthropic.com/settings/billing',
  baseUrl: BASE_URL,
  defaultModel: 'claude-sonnet-4-5',
  local: false,
  capabilities: CAPABILITIES,
  discovery: 'id-list',
};

interface AnthropicFrame {
  type?: string;
  delta?: { type?: string; text?: string };
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Split Fixora's neutral messages into Anthropic's shape.
 *
 * Every `system` message is concatenated into the top-level field; the rest keep their order. Done
 * here so the prompt builder stays provider-blind — the alternative is a prompt that knows which
 * vendor will receive it, which is exactly what the adapter layer exists to prevent.
 */
export function toAnthropicBody(
  request: ProviderRequest,
  maxTokens: number,
): Record<string, unknown> {
  const system = request.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const messages = request.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

  const body: Record<string, unknown> = {
    model: request.model,
    // Required by the API. `?? maxTokens` rather than omitting: a 400 for a missing field is a
    // confusing way to learn that a budget was optional upstream.
    max_tokens: request.maxOutputTokens ?? maxTokens,
    messages,
    stream: true,
  };
  if (system !== '') body['system'] = system;
  if (request.temperature !== undefined) body['temperature'] = request.temperature;
  return body;
}

/** Anthropic's error body: `{type:'error', error:{type, message}}`. */
function readErrorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { type?: unknown; message?: unknown } };
    const message = parsed.error?.message;
    return typeof message === 'string' ? message.slice(0, 300) : raw.slice(0, 300);
  } catch {
    return raw.slice(0, 300);
  }
}

/**
 * Provider-specific hints, in the same shape `describeStatus` uses for the OpenAI-compatible
 * adapters — so the classifier in `failure.ts` reads one consistent string whatever answered.
 */
function describeStatus(status: number, model: string): string | null {
  if (status === 404) {
    return `Anthropic has no model called "${model}" for this key. Model ids change between generations — check the id in Settings.`;
  }
  if (status === 400) {
    return 'Anthropic rejected the request shape. If this persists, the model may not support the requested output size.';
  }
  if (status === 529) {
    // Anthropic-specific: distinct from 503, and explicitly temporary.
    return 'Anthropic is overloaded right now. This is temporary and on their side.';
  }
  return null;
}

export interface AnthropicOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: FetchLike;
  readonly maxTokens?: number;
}

export function createAnthropicProvider(options: AnthropicOptions): AIProvider {
  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const base = (options.baseUrl ?? BASE_URL).replace(/\/+$/, '');
  const messagesUrl = `${base}/messages`;
  const modelsUrl = `${base}/models`;

  function headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': options.apiKey,
      'anthropic-version': API_VERSION,
    };
  }

  /** Accumulated across frames: Anthropic reports input and output usage in different events. */
  let inputTokens = 0;

  function* handleLine(line: string): Iterable<ProviderEvent> {
    const data = sseData(line);
    if (data === null) return;

    let frame: AnthropicFrame;
    try {
      frame = JSON.parse(data) as AnthropicFrame;
    } catch {
      return; // a keep-alive or a comment; not fatal
    }

    if (frame.type === 'message_start') {
      inputTokens = frame.message?.usage?.input_tokens ?? 0;
      return;
    }
    if (frame.type === 'content_block_delta' && frame.delta?.type === 'text_delta') {
      const text = frame.delta.text;
      if (typeof text === 'string' && text.length > 0) yield { type: 'text_delta', text };
      return;
    }
    if (frame.type === 'message_delta') {
      const output = frame.usage?.output_tokens;
      if (typeof output === 'number') {
        yield { type: 'usage', inputTokens, outputTokens: output, cachedTokens: 0 };
      }
    }
  }

  async function* stream(
    request: ProviderRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    inputTokens = 0;
    let response: Response;
    console.error('[provider] request', {
      provider: 'anthropic',
      baseUrl: base,
      model: request.model,
      key: keyFingerprint(options.apiKey),
    });
    try {
      response = await doFetch(messagesUrl, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(toAnthropicBody(request, options.maxTokens ?? DEFAULT_MAX_TOKENS)),
        signal,
      });
    } catch (error) {
      if (signal.aborted) return;
      console.error('[provider] FAILED — request did not reach the provider', {
        provider: 'anthropic',
        reachedProvider: false,
        errorOrigin: 'fixora',
        detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
      yield {
        type: 'error',
        retryable: true,
        providerCode: 'NETWORK',
        message: error instanceof Error ? error.name : 'network error',
      };
      return;
    }

    if (!response.ok) {
      const raw = await response.clone().text();
      const detail = readErrorMessage(raw);
      const hint = describeStatus(response.status, request.model);
      const requestId = response.headers.get('request-id') ?? undefined;
      // The SAME facts extraction every other adapter uses — Anthropic sends standard
      // `retry-after` and `anthropic-ratelimit-*` headers, and `readRateLimit` reads both shapes.
      const rateLimit = readRateLimit(response.headers, raw);
      console.error('[provider] FAILED — the provider refused the request', {
        provider: 'anthropic',
        model: request.model,
        key: keyFingerprint(options.apiKey),
        reachedProvider: true,
        errorOrigin: 'provider',
        status: response.status,
        statusText: response.statusText,
        ...(requestId === undefined ? {} : { requestId }),
        body: raw.slice(0, 8000),
      });
      yield {
        type: 'error',
        // Matches the shared policy: 429 and 5xx are worth another provider, everything else is not.
        retryable: response.status === 429 || response.status >= 500,
        providerCode: `HTTP_${String(response.status)}`,
        message: [`${String(response.status)} ${response.statusText}`.trim(), detail, hint]
          .filter((part) => part !== null && part !== '')
          .join(' — '),
        status: response.status,
        ...(requestId === undefined ? {} : { requestId }),
        ...(Object.keys(rateLimit).length > 0 ? { rateLimit } : {}),
      };
      return;
    }

    if (response.body === null) {
      yield {
        type: 'error',
        retryable: true,
        providerCode: 'NO_BODY',
        message: 'The provider accepted the request but returned no response stream.',
      };
      return;
    }

    yield* readSseStream(response.body, handleLine, signal);
  }

  /**
   * Test via the model list: it exercises the base URL and the credential without spending tokens,
   * and answers "is the model there" in the same round trip. Identical strategy to the
   * OpenAI-compatible adapters, so Test Connection behaves the same for every provider.
   */
  async function test(model: string, signal: AbortSignal): Promise<ProviderTestResult> {
    const startedAt = Date.now();
    try {
      const response = await doFetch(modelsUrl, { method: 'GET', headers: headers(), signal });
      const latencyMs = Date.now() - startedAt;
      if (response.status === 401 || response.status === 403) {
        return { reachable: true, authenticated: false, modelAvailable: null, latencyMs };
      }
      if (!response.ok) {
        return { reachable: true, authenticated: true, modelAvailable: null, latencyMs };
      }
      const parsed = (await response.json()) as { data?: readonly { id?: unknown }[] };
      const models = (parsed.data ?? [])
        .map((entry) => entry.id)
        .filter((id): id is string => typeof id === 'string');
      return {
        reachable: true,
        authenticated: true,
        modelAvailable: models.length === 0 ? null : models.includes(model),
        latencyMs,
        models,
      };
    } catch {
      return {
        reachable: false,
        authenticated: null,
        modelAvailable: null,
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  return {
    id: 'anthropic',
    capabilities: {
      structuredOutput: false,
      maxContext: CAPABILITIES.typicalContext,
    },
    stream,
    test,
  };
}

export const anthropicRegistration: ProviderRegistration = {
  descriptor: anthropicDescriptor,
  create: ({ apiKey, baseUrl, fetchImpl }) =>
    createAnthropicProvider({
      apiKey: apiKey ?? '',
      baseUrl,
      ...(fetchImpl === undefined ? {} : { fetchImpl: fetchImpl }),
    }),
};
