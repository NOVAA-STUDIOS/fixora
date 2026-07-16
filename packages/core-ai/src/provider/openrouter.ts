import type {
  AIProvider,
  ProviderEvent,
  ProviderRequest,
} from './types.js';

/**
 * The OpenRouter adapter — the beta's single BYOK transport.
 *
 * OpenRouter speaks the OpenAI chat-completions wire format and fronts every major provider, so one
 * SSE client gives the user their choice of model with their own key. The key is passed per call
 * (it lives in the OS keychain and is read in the main process at call time — never stored here,
 * never logged). `fetch` is injected so the adapter is unit-testable without a network.
 */

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

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

    if (!response.ok || response.body === null) {
      yield {
        type: 'error',
        // 429 and 5xx are worth a retry/failover; 4xx (bad key, bad request) is not.
        retryable: response.status === 429 || response.status >= 500,
        providerCode: `HTTP_${String(response.status)}`,
        message: `provider returned ${String(response.status)}`,
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
