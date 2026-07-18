import { describe, expect, it } from 'vitest';

import { createOpenRouterProvider, type FetchLike } from './openrouter.js';
import type { ProviderEvent, ProviderRequest } from './types.js';

const REQUEST: ProviderRequest = {
  model: 'anthropic/claude-3.5-sonnet',
  messages: [{ role: 'user', content: 'hello' }],
};

function sseResponse(lines: readonly string[], init: ResponseInit = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(body, { status: 200, ...init });
}

async function collect(events: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe('OpenRouter provider', () => {
  it('yields text deltas and a final usage event from an SSE stream', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"The "}}]}\n',
          'data: {"choices":[{"delta":{"content":"null check"}}]}\n',
          'data: {"choices":[{"delta":{"content":" is missing."}}]}\n',
          'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":2140,"completion_tokens":38}}\n',
          'data: [DONE]\n',
        ]),
      );
    const provider = createOpenRouterProvider({ apiKey: 'sk-or-test', fetchImpl });

    const events = await collect(provider.stream(REQUEST, new AbortController().signal));

    const text = events
      .filter((e): e is Extract<ProviderEvent, { type: 'text_delta' }> => e.type === 'text_delta')
      .map((e) => e.text)
      .join('');
    expect(text).toBe('The null check is missing.');

    const usage = events.find((e) => e.type === 'usage');
    expect(usage).toEqual({ type: 'usage', inputTokens: 2140, outputTokens: 38, cachedTokens: 0 });
  });

  it('handles deltas split across chunk boundaries', async () => {
    // The bytes for one SSE line arrive in two reads — the buffer must not lose the split line.
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        sseResponse(['data: {"choices":[{"delta":{"content":"hel', 'lo"}}]}\n', 'data: [DONE]\n']),
      );
    const provider = createOpenRouterProvider({ apiKey: 'k', fetchImpl });
    const events = await collect(provider.stream(REQUEST, new AbortController().signal));
    expect(events).toEqual([{ type: 'text_delta', text: 'hello' }]);
  });

  it('surfaces a retryable error for 429', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(new Response('rate limited', { status: 429 }));
    const provider = createOpenRouterProvider({ apiKey: 'k', fetchImpl });
    const [event] = await collect(provider.stream(REQUEST, new AbortController().signal));
    expect(event).toMatchObject({ type: 'error', retryable: true, providerCode: 'HTTP_429' });
  });

  it('surfaces a non-retryable error for 401 (bad key)', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(new Response('unauthorized', { status: 401 }));
    const provider = createOpenRouterProvider({ apiKey: 'bad', fetchImpl });
    const [event] = await collect(provider.stream(REQUEST, new AbortController().signal));
    expect(event).toMatchObject({ type: 'error', retryable: false, providerCode: 'HTTP_401' });
  });

  it('treats an aborted request as cancelled, not an error', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl: FetchLike = () => Promise.reject(new DOMException('aborted', 'AbortError'));
    const provider = createOpenRouterProvider({ apiKey: 'k', fetchImpl });
    const events = await collect(provider.stream(REQUEST, controller.signal));
    expect(events).toEqual([]);
  });

  it('sends the key as a Bearer header and requests JSON-schema output when asked', async () => {
    let seen: RequestInit | undefined;
    const fetchImpl: FetchLike = (_url, init) => {
      seen = init;
      return Promise.resolve(sseResponse(['data: [DONE]\n']));
    };
    const provider = createOpenRouterProvider({ apiKey: 'sk-or-secret', fetchImpl });
    await collect(
      provider.stream(
        { ...REQUEST, responseSchema: { name: 'patch', schema: { type: 'object' } } },
        new AbortController().signal,
      ),
    );
    const headers = seen?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-or-secret');
    const body = JSON.parse(seen?.body as string) as Record<string, unknown>;
    expect(body['response_format']).toMatchObject({ type: 'json_schema' });
  });
});
