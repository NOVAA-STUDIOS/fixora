import { describe, expect, it } from 'vitest';

import { createOpenRouterProvider, type FetchLike } from './adapters/openrouter.js';
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

/**
 * Regression: the beta shipped model ids that OpenRouter had retired, so every AI action returned
 * 404 — and the adapter discarded the response body, leaving the user with "Provider error
 * (HTTP 404)" and nothing to act on. The status is not the diagnosis; the body is.
 */
describe('error reporting', () => {
  function errorResponse(status: number, body: string, statusText = ''): Response {
    return new Response(body, { status, statusText });
  }

  async function firstEvent(response: Response, model = 'anthropic/claude-sonnet-5') {
    const provider = createOpenRouterProvider({
      apiKey: 'sk-or-v1-test',
      fetchImpl: () => Promise.resolve(response),
    });
    for await (const event of provider.stream(
      { model, messages: [{ role: 'user', content: 'hi' }] },
      new AbortController().signal,
    )) {
      return event;
    }
    throw new Error('provider yielded no event');
  }

  it("surfaces OpenRouter's own message for a 404 instead of only the status", async () => {
    const event = await firstEvent(
      errorResponse(404, JSON.stringify({ error: { message: 'No endpoints found for model' } })),
    );
    expect(event.type).toBe('error');
    if (event.type !== 'error') return;
    expect(event.message).toContain('No endpoints found for model');
    expect(event.providerCode).toBe('HTTP_404');
    // A 404 is a bad model id, not a transient fault — retrying it just burns time.
    expect(event.retryable).toBe(false);
  });

  it('names the rejected model on a 404, since that is the thing to change', async () => {
    const event = await firstEvent(
      errorResponse(404, JSON.stringify({ error: { message: 'not found' } })),
      'anthropic/claude-3.5-sonnet',
    );
    if (event.type !== 'error') throw new Error('expected error');
    expect(event.message).toContain('anthropic/claude-3.5-sonnet');
    expect(event.message).toContain('openrouter.ai/models');
  });

  it('points at the key for 401, and stays retryable for 429/5xx', async () => {
    const unauthorized = await firstEvent(
      errorResponse(401, JSON.stringify({ error: { message: 'Invalid API key' } })),
    );
    if (unauthorized.type !== 'error') throw new Error('expected error');
    expect(unauthorized.message).toContain('Invalid API key');
    expect(unauthorized.message).toContain('Settings');
    expect(unauthorized.retryable).toBe(false);

    const rateLimited = await firstEvent(errorResponse(429, '{}'));
    if (rateLimited.type !== 'error') throw new Error('expected error');
    expect(rateLimited.retryable).toBe(true);

    const serverError = await firstEvent(errorResponse(503, '{}'));
    if (serverError.type !== 'error') throw new Error('expected error');
    expect(serverError.retryable).toBe(true);
  });

  it('degrades to the status when the body is not JSON, rather than throwing', async () => {
    const event = await firstEvent(errorResponse(502, '<html>Bad Gateway</html>'));
    if (event.type !== 'error') throw new Error('expected error');
    expect(event.message).toContain('502');
    expect(event.message).toContain('Bad Gateway');
  });

  it('posts to the documented chat-completions endpoint', async () => {
    let seenUrl = '';
    const provider = createOpenRouterProvider({
      apiKey: 'sk-or-v1-test',
      fetchImpl: (url) => {
        seenUrl = url;
        return Promise.resolve(new Response('', { status: 500 }));
      },
    });
    for await (const ignored of provider.stream(
      { model: 'anthropic/claude-sonnet-5', messages: [{ role: 'user', content: 'hi' }] },
      new AbortController().signal,
    )) {
      void ignored;
      break;
    }
    expect(seenUrl).toBe('https://openrouter.ai/api/v1/chat/completions');
  });
});
