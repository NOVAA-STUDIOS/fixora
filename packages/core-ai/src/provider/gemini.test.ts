import { describe, expect, it } from 'vitest';

import { createGeminiProvider, toGeminiBody } from './adapters/gemini.js';
import type { FetchLike } from './adapters/openai-compatible.js';
import { shouldFailover } from './failover.js';
import { describeProviderFailure } from './failure.js';
import type { ProviderEvent, ProviderRequest } from './types.js';

/**
 * Google Gemini — the furthest from the OpenAI shape.
 *
 * The role mapping and the system split are the two things most likely to break silently: a wrong
 * role is a 400 (noisy, easy), but a DROPPED system prompt produces a plausible-looking repair
 * generated without any of its instructions (quiet, dangerous). Both are pinned below, along with
 * the credential going in a header rather than the URL.
 */
const REQUEST: ProviderRequest = {
  model: 'gemini-2.5-flash',
  messages: [
    { role: 'system', content: 'You are a repair engine.' },
    { role: 'user', content: 'fix this' },
  ],
};

function sse(lines: readonly string[], init: ResponseInit = {}): Response {
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

describe('Gemini — request shaping', () => {
  it('moves system text to systemInstruction — a dropped one fails silently', () => {
    const body = toGeminiBody(REQUEST);
    expect(body['systemInstruction']).toEqual({ parts: [{ text: 'You are a repair engine.' }] });
    expect(body['contents']).toEqual([{ role: 'user', parts: [{ text: 'fix this' }] }]);
  });

  it("maps the assistant role to Gemini's 'model' — 'assistant' is a 400", () => {
    const body = toGeminiBody({
      model: 'm',
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ],
    });
    expect(body['contents']).toEqual([
      { role: 'user', parts: [{ text: 'a' }] },
      { role: 'model', parts: [{ text: 'b' }] },
    ]);
  });

  it('asks for JSON when a schema was requested', () => {
    const body = toGeminiBody({
      ...REQUEST,
      responseSchema: { name: 'repair', schema: { type: 'object' } },
    });
    const config = body['generationConfig'] as Record<string, unknown>;
    expect(config['responseMimeType']).toBe('application/json');
    expect(config['responseSchema']).toEqual({ type: 'object' });
  });

  it('omits generationConfig entirely when there is nothing to configure', () => {
    const body = toGeminiBody({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
    expect(body).not.toHaveProperty('generationConfig');
  });

  it('puts the model in the PATH and the key in a HEADER, never in the URL', async () => {
    // A credential in a URL lands in proxy logs, crash reports and shell history.
    let url = '';
    let headers: Record<string, string> = {};
    const fetchImpl: FetchLike = (input, init) => {
      url = input;
      headers = (init.headers ?? {}) as Record<string, string>;
      return Promise.resolve(sse(['data: {"candidates":[]}\n']));
    };
    await collect(
      createGeminiProvider({ apiKey: 'AIza-secret', fetchImpl }).stream(
        REQUEST,
        new AbortController().signal,
      ),
    );
    expect(url).toContain('/models/gemini-2.5-flash:streamGenerateContent');
    expect(url).toContain('alt=sse');
    expect(url).not.toContain('AIza-secret');
    expect(headers['x-goog-api-key']).toBe('AIza-secret');
  });
});

describe('Gemini — success path yields the same events as every other adapter', () => {
  it('extracts text from candidates[].content.parts[], several per frame', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        sse([
          'data: {"candidates":[{"content":{"parts":[{"text":"const "},{"text":"a = 1;"}]}}]}\n',
          'data: {"candidates":[{"content":{"parts":[{"text":" done"}]}}],"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":4}}\n',
        ]),
      );
    const events = await collect(
      createGeminiProvider({ apiKey: 'k', fetchImpl }).stream(
        REQUEST,
        new AbortController().signal,
      ),
    );
    expect(
      events.filter((e) => e.type === 'text_delta').map((e) => (e as { text: string }).text),
    ).toEqual(['const ', 'a = 1;', ' done']);
    expect(events.find((e) => e.type === 'usage')).toEqual({
      type: 'usage',
      inputTokens: 9,
      outputTokens: 4,
      cachedTokens: 0,
    });
  });

  it('survives a frame with no candidates rather than erroring', async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(sse(['data: {"candidates":[]}\n']));
    const events = await collect(
      createGeminiProvider({ apiKey: 'k', fetchImpl }).stream(
        REQUEST,
        new AbortController().signal,
      ),
    );
    expect(events).toEqual([]);
  });
});

describe('Gemini — every failure type', () => {
  async function failWith(status: number, body: string, headers: Record<string, string> = {}) {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(new Response(body, { status, statusText: 'x', headers }));
    const events = await collect(
      createGeminiProvider({ apiKey: 'k', fetchImpl }).stream(
        REQUEST,
        new AbortController().signal,
      ),
    );
    return events.find((e) => e.type === 'error') as Extract<ProviderEvent, { type: 'error' }>;
  }

  it('invalid key — 403 names the API-enablement trap', async () => {
    const error = await failWith(
      403,
      '{"error":{"code":403,"message":"API key not valid","status":"PERMISSION_DENIED"}}',
    );
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('API key not valid');
    expect(error.message).toMatch(/Generative Language API is enabled/i);
  });

  it('quota exceeded — 429 is retryable and carries what facts were sent', async () => {
    const error = await failWith(
      429,
      '{"error":{"code":429,"message":"Quota exceeded","status":"RESOURCE_EXHAUSTED"}}',
      { 'retry-after': '60' },
    );
    expect(error.retryable).toBe(true);
    expect(error.rateLimit?.retryAfterSeconds).toBe(60);
    const failure = describeProviderFailure({ providerCode: error.providerCode, detail: error.message });
    expect(failure.category).toBe('quota-exceeded');
  });

  it('model unavailable — 404 explains the id is part of the URL', async () => {
    const error = await failWith(404, '{"error":{"message":"models/x is not found"}}');
    expect(error.message).toMatch(/part of the request URL/i);
  });

  it('server error — 500 is retryable', async () => {
    const error = await failWith(500, '{"error":{"message":"internal"}}');
    expect(error.retryable).toBe(true);
  });

  it('network failure — never reached the provider', async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new TypeError('fetch failed'));
    const events = await collect(
      createGeminiProvider({ apiKey: 'k', fetchImpl }).stream(
        REQUEST,
        new AbortController().signal,
      ),
    );
    expect(events).toEqual([
      { type: 'error', retryable: true, providerCode: 'NETWORK', message: 'TypeError' },
    ]);
  });
});

describe('Gemini — failover eligibility follows the shared policy', () => {
  const candidate = { provider: 'gemini', model: 'gemini-2.5-flash', local: false };

  it('fails over for availability failures', () => {
    for (const code of ['HTTP_429', 'HTTP_503']) {
      expect(
        shouldFailover(describeProviderFailure({ providerCode: code, detail: 'x' }), candidate),
        code,
      ).toBe(true);
    }
  });

  it('does NOT fail over for a rejected credential', () => {
    for (const code of ['HTTP_401', 'HTTP_403']) {
      expect(
        shouldFailover(describeProviderFailure({ providerCode: code, detail: 'x' }), candidate),
        code,
      ).toBe(false);
    }
  });
});

describe('Gemini — test()', () => {
  it('strips the models/ prefix so ids match what the user configured', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash' }, { name: 'models/other' }] }),
          { status: 200 },
        ),
      );
    const result = await createGeminiProvider({ apiKey: 'k', fetchImpl }).test(
      'gemini-2.5-flash',
      new AbortController().signal,
    );
    expect(result.models).toEqual(['gemini-2.5-flash', 'other']);
    expect(result.modelAvailable).toBe(true);
  });

  it('reports unauthenticated for a refused key', async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(new Response('{}', { status: 403 }));
    const result = await createGeminiProvider({ apiKey: 'k', fetchImpl }).test(
      'm',
      new AbortController().signal,
    );
    expect(result).toMatchObject({ reachable: true, authenticated: false });
  });
});
