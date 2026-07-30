import type { JsonStrategy } from '../capability.js';
import { describeProviderFailure } from '../failure.js';
import type {
  AIProvider,
  ProviderEvent,
  ProviderRequest,
  ProviderTestResult,
} from '../types.js';

/**
 * The OpenAI chat-completions wire format, as a reusable adapter.
 *
 * This one file is why "a new provider is a new adapter" is true rather than aspirational: OpenAI,
 * OpenRouter, Azure OpenAI, Groq, Together, Fireworks, LM Studio and vLLM all speak this protocol.
 * Each is this adapter with a different base URL, auth header and set of extra headers — a descriptor,
 * not an integration.
 *
 * Extracted from the OpenRouter adapter rather than written fresh, so the SSE handling, the error
 * body parsing and the usage accounting that survived the beta are the same code, not a
 * reimplementation that has to re-earn that trust.
 */

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Cap on how much of an error body we quote — enough to classify, not enough to flood a log. */
const MAX_ERROR_CHARS = 300;

export interface OpenAiCompatibleOptions {
  /** Adapter id, surfaced in diagnostics. */
  readonly id: string;
  /** API base, no trailing slash — e.g. `https://api.openai.com/v1`. */
  readonly baseUrl: string;
  /** Null for endpoints that need no credential (a local vLLM, say). */
  readonly apiKey: string | null;
  /** How this endpoint wants JSON forced. */
  readonly jsonStrategy: JsonStrategy;
  readonly maxContext: number;
  /** Extra headers — OpenRouter's attribution pair, Azure's api-key, and so on. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetchImpl?: FetchLike;
  /**
   * Provider-specific hint for a failed response, appended to the log detail so the classifier can
   * separate cases the status code alone cannot (a 404 model slug vs a 404 route).
   */
  readonly describeStatus?: (status: number, model: string) => string | null;
}

interface StreamChunk {
  choices?: readonly { delta?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

interface ModelListResponse {
  data?: readonly { id?: unknown }[];
}

/** Translate the neutral request into this protocol's body. */
export function buildChatBody(request: ProviderRequest, jsonStrategy: JsonStrategy): string {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    stream: true,
    // Ask for a final usage chunk so the run can be metered.
    stream_options: { include_usage: true },
  };
  if (request.maxOutputTokens !== undefined) body['max_tokens'] = request.maxOutputTokens;
  if (request.temperature !== undefined) body['temperature'] = request.temperature;

  if (request.responseSchema !== undefined) {
    if (jsonStrategy === 'json-schema') {
      body['response_format'] = {
        type: 'json_schema',
        json_schema: {
          name: request.responseSchema.name,
          strict: true,
          schema: request.responseSchema.schema,
        },
      };
    } else if (jsonStrategy === 'json-object') {
      // No schema enforcement available. Ask for JSON and let the parser+verifier do their job —
      // which they already do, because a model can always ignore a schema it was given.
      body['response_format'] = { type: 'json_object' };
    }
    // 'none': the capability matrix should have kept this candidate out of the chain entirely.
  }
  return JSON.stringify(body);
}

/** Pull the provider's own explanation out of a failed response, degrading rather than throwing. */
export async function readErrorBody(response: Response): Promise<string> {
  try {
    const raw = await response.text();
    if (raw === '') return '';
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: unknown } | string };
      const fromJson = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message;
      return (typeof fromJson === 'string' ? fromJson : raw).trim().slice(0, MAX_ERROR_CHARS);
    } catch {
      return raw.trim().slice(0, MAX_ERROR_CHARS); // not JSON — still a clue
    }
  } catch {
    return ''; // body consumed or connection dropped; the status alone will have to do
  }
}

/**
 * Turn a failed HTTP response into a diagnostic string.
 *
 * Reproduces the OpenRouter adapter's original behaviour byte for byte — status line, then the
 * provider's own words, then any provider-specific hint, then the shared auth hint — because this
 * string is what `describeProviderFailure` reads to separate cases the status code alone cannot
 * (a throttling 429 from an exhausted-quota 429). Changing it silently would change classification.
 *
 * It is a LOG string, never rendered: the user sees the classifier's wording, not this.
 */
export async function describeErrorResponse(
  response: Response,
  model: string,
  describeStatus?: (status: number, model: string) => string | null,
): Promise<string> {
  const providerMessage = await readErrorBody(response);

  const parts = [`${String(response.status)} ${response.statusText}`.trim()];
  if (providerMessage !== '') parts.push(providerMessage);

  const hint = describeStatus?.(response.status, model) ?? null;
  if (hint !== null) parts.push(hint);

  // Shared across every OpenAI-compatible endpoint: a rejected credential is fixed in one place.
  if (response.status === 401 || response.status === 403) {
    parts.push('Check your API key in Settings.');
  }
  return parts.join(' — ');
}

function* handleLine(line: string): Iterable<ProviderEvent> {
  if (!line.startsWith('data:')) return;
  const data = line.slice('data:'.length).trim();
  if (data === '' || data === '[DONE]') return;

  let chunk: StreamChunk;
  try {
    chunk = JSON.parse(data) as StreamChunk;
  } catch {
    return; // a malformed keep-alive or comment line is not fatal
  }

  const delta = chunk.choices?.[0]?.delta?.content;
  if (typeof delta === 'string' && delta.length > 0) {
    yield { type: 'text_delta', text: delta };
  }
  if (chunk.usage !== null && chunk.usage !== undefined) {
    yield {
      type: 'usage',
      inputTokens: chunk.usage.prompt_tokens ?? 0,
      outputTokens: chunk.usage.completion_tokens ?? 0,
      cachedTokens: 0,
    };
  }
}

export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): AIProvider {
  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const chatUrl = `${options.baseUrl}/chat/completions`;
  const modelsUrl = `${options.baseUrl}/models`;

  function headers(): Record<string, string> {
    const base: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options.apiKey !== null) base['Authorization'] = `Bearer ${options.apiKey}`;
    return { ...base, ...options.headers };
  }

  async function* stream(
    request: ProviderRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    let response: Response;
    try {
      response = await doFetch(chatUrl, {
        method: 'POST',
        headers: headers(),
        body: buildChatBody(request, options.jsonStrategy),
        signal,
      });
    } catch (error) {
      if (signal.aborted) return; // a cancelled stream is not an error (AI-Pipeline §6)
      yield {
        type: 'error',
        retryable: true,
        providerCode: 'NETWORK',
        message: error instanceof Error ? error.name : 'network error',
      };
      return;
    }

    if (!response.ok) {
      const requestId = response.headers.get('x-request-id') ?? undefined;
      yield {
        type: 'error',
        retryable: response.status === 429 || response.status >= 500,
        providerCode: `HTTP_${String(response.status)}`,
        message: await describeErrorResponse(response, request.model, options.describeStatus),
        status: response.status,
        ...(requestId === undefined ? {} : { requestId }),
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

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value as Uint8Array, { stream: true });

        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
          yield* handleLine(line);
        }
      }
    } catch (error) {
      if (signal.aborted) return;
      yield {
        type: 'error',
        retryable: true,
        providerCode: 'STREAM',
        message: error instanceof Error ? error.name : 'stream error',
      };
    }
  }

  /**
   * Test via the model list rather than a completion: it exercises the base URL and the credential
   * without spending tokens, and it answers "is the model there" in the same round trip.
   */
  async function test(model: string, signal: AbortSignal): Promise<ProviderTestResult> {
    const started = Date.now();
    let response: Response;
    try {
      response = await doFetch(modelsUrl, { method: 'GET', headers: headers(), signal });
    } catch {
      return {
        reachable: false,
        authenticated: null,
        modelAvailable: null,
        latencyMs: Date.now() - started,
        failure: describeProviderFailure({ providerCode: 'NETWORK' }),
      };
    }

    const latencyMs = Date.now() - started;
    if (!response.ok) {
      const body = await readErrorBody(response);
      return {
        // The host answered, so it is reachable; the credential is what it rejected.
        reachable: true,
        authenticated: response.status === 401 || response.status === 403 ? false : null,
        modelAvailable: null,
        latencyMs,
        failure: describeProviderFailure({
          providerCode: `HTTP_${String(response.status)}`,
          detail: body,
        }),
      };
    }

    let models: string[];
    try {
      const parsed = (await response.json()) as ModelListResponse;
      models = (parsed.data ?? [])
        .map((entry) => entry.id)
        .filter((id): id is string => typeof id === 'string');
    } catch {
      // A 200 with an unreadable body still proves reachability and auth; model presence is unknown.
      return { reachable: true, authenticated: true, modelAvailable: null, latencyMs };
    }

    return {
      reachable: true,
      authenticated: true,
      // Only claim the model is missing when we actually got a list to check against.
      modelAvailable: models.length === 0 ? null : models.includes(model),
      latencyMs,
      models,
    };
  }

  return {
    id: options.id,
    capabilities: {
      structuredOutput: options.jsonStrategy !== 'none',
      maxContext: options.maxContext,
    },
    stream,
    test,
  };
}
