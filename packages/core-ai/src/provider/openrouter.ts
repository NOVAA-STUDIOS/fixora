import type { AIProvider, ProviderEvent, ProviderRequest } from './types.js';

/**
 * The OpenRouter adapter — the beta's single BYOK transport.
 *
 * OpenRouter speaks the OpenAI chat-completions wire format and fronts every major provider, so one
 * SSE client gives the user their choice of model with their own key. The key is passed per call
 * (it lives in the OS keychain and is read in the main process at call time — never stored here,
 * never logged). `fetch` is injected so the adapter is unit-testable without a network.
 */

/** The documented chat-completions endpoint. Exported so the app layer can name it in diagnostics. */
export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const ENDPOINT = OPENROUTER_ENDPOINT;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface OpenRouterOptions {
  readonly apiKey: string;
  readonly fetchImpl?: FetchLike;
  /** Sent as HTTP-Referer/X-Title, which OpenRouter uses for attribution. Not sensitive. */
  readonly appUrl?: string;
  readonly appName?: string;
}

interface StreamChunk {
  choices?: readonly { delta?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

function buildBody(request: ProviderRequest): string {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    stream: true,
    // Ask OpenRouter to include a final usage chunk so we can meter (and, later, show cost).
    stream_options: { include_usage: true },
  };
  if (request.maxOutputTokens !== undefined) body['max_tokens'] = request.maxOutputTokens;
  if (request.temperature !== undefined) body['temperature'] = request.temperature;
  if (request.responseSchema !== undefined) {
    body['response_format'] = {
      type: 'json_schema',
      json_schema: {
        name: request.responseSchema.name,
        strict: true,
        schema: request.responseSchema.schema,
      },
    };
  }
  return JSON.stringify(body);
}

export function createOpenRouterProvider(options: OpenRouterOptions): AIProvider {
  const doFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));

  async function* stream(
    request: ProviderRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (options.appUrl !== undefined) headers['HTTP-Referer'] = options.appUrl;
    if (options.appName !== undefined) headers['X-Title'] = options.appName;

    let response: Response;
    try {
      response = await doFetch(ENDPOINT, {
        method: 'POST',
        headers,
        body: buildBody(request),
        signal,
      });
    } catch (error) {
      if (signal.aborted) return; // A cancelled stream is not an error (AI-Pipeline §6).
      yield {
        type: 'error',
        retryable: true,
        providerCode: 'NETWORK',
        message: error instanceof Error ? error.name : 'network error',
      };
      return;
    }

    if (!response.ok) {
      // Read the body. OpenRouter explains *why* it rejected the call ("model not found", "insufficient
      // credits", "invalid api key"); discarding it and reporting only the status leaves the user with
      // "HTTP 404" and nothing to act on — which is exactly the dead end this branch used to create.
      yield {
        type: 'error',
        // 429 and 5xx are worth a retry/failover; 4xx (bad key, bad request, unknown model) is not.
        retryable: response.status === 429 || response.status >= 500,
        providerCode: `HTTP_${String(response.status)}`,
        message: await describeErrorResponse(response, request.model),
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
        const bytes = result.value as Uint8Array;
        buffer += decoder.decode(bytes, { stream: true });

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

  return {
    id: 'openrouter',
    capabilities: { structuredOutput: true, maxContext: 128_000 },
    stream,
  };
}

/** Cap on how much of an error body we quote — enough to be useful, not enough to flood a toast. */
const MAX_ERROR_CHARS = 300;

/**
 * Turn a failed HTTP response into something a user can act on.
 *
 * OpenRouter returns `{ "error": { "message": ..., "code": ... } }`, but the body is not guaranteed —
 * a proxy or a gateway can return HTML or nothing at all — so every step degrades instead of throwing.
 * We never echo the request back, only the provider's own explanation: the request carries the user's
 * source code, and an error path is no place to start copying that around.
 *
 * The 404 case gets a specific hint because it is almost always one thing: OpenRouter answers 404 when
 * the model slug does not resolve, and slugs are retired as providers rotate their line-ups.
 */
async function describeErrorResponse(response: Response, model: string): Promise<string> {
  let providerMessage = '';
  try {
    const raw = await response.text();
    if (raw !== '') {
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: unknown } | string };
        const fromJson = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message;
        providerMessage = typeof fromJson === 'string' ? fromJson : raw;
      } catch {
        providerMessage = raw; // not JSON — quote it as-is, it is still a clue
      }
    }
  } catch {
    // Body already consumed or the connection dropped mid-read; the status alone will have to do.
  }

  providerMessage = providerMessage.trim().slice(0, MAX_ERROR_CHARS);

  const parts = [`${String(response.status)} ${response.statusText}`.trim()];
  if (providerMessage !== '') parts.push(providerMessage);
  if (response.status === 404) {
    parts.push(
      `The model id "${model}" was not accepted by OpenRouter. Model ids are retired over time — ` +
        'check Settings → AI against the current list at https://openrouter.ai/models.',
    );
  }
  if (response.status === 401 || response.status === 403) {
    parts.push('Check your API key in Settings → AI.');
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
    return; // A malformed keep-alive or comment line is not fatal; ignore it.
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
