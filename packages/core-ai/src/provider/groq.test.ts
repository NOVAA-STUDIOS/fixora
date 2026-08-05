import { describe, expect, it } from 'vitest';

import { createGroqProvider, groqDescriptor } from './adapters/groq.js';
import type { FetchLike } from './adapters/openai-compatible.js';
import { shouldFailover } from './failover.js';
import { describeProviderFailure } from './failure.js';
import type { ProviderEvent, ProviderRequest } from './types.js';

/**
 * Groq — an OpenAI-compatible endpoint, so it reuses `openai-compatible.ts` rather than duplicating
 * the wire handling.
 *
 * That reuse is the thing worth testing. These do not re-prove SSE parsing (openrouter.test.ts owns
 * that); they prove Groq is wired to the shared implementation correctly — right URL, right auth,
 * right JSON strategy — and that its provider-specific error wording reaches the user.
 */
const REQUEST: ProviderRequest = {
  model: 'llama-3.3-70b-versatile',
  messages: [{ role: 'user', content: 'fix this' }],
};

function sse(lines: readonly string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

async function collect(events: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe('Groq — reuses the OpenAI-compatible core', () => {
  it('calls the Groq chat-completions endpoint with a bearer token', async () => {
    let url = '';
    let headers: Record<string, string> = {};
    const fetchImpl: FetchLike = (input, init) => {
      url = input;
      headers = (init.headers ?? {}) as Record<string, string>;
      return Promise.resolve(sse(['data: [DONE]\n']));
    };
    await collect(
      createGroqProvider({ apiKey: 'gsk-test', fetchImpl }).stream(
        REQUEST,
        new AbortController().signal,
      ),
    );
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(headers['Authorization']).toBe('Bearer gsk-test');
  });

  it('yields the same text deltas as every other OpenAI-compatible provider', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        sse([
          'data: {"choices":[{"delta":{"content":"const "}}]}\n',
          'data: {"choices":[{"delta":{"content":"a = 1;"}}]}\n',
          'data: [DONE]\n',
        ]),
      );
    const events = await collect(
      createGroqProvider({ apiKey: 'k', fetchImpl }).stream(
        REQUEST,
        new AbortController().signal,
      ),
    );
    expect(events).toEqual([
      { type: 'text_delta', text: 'const ' },
      { type: 'text_delta', text: 'a = 1;' },
    ]);
  });

  it('asks for json_object, not a schema — Groq models vary in schema support', () => {
    // A schema an engine cannot enforce is a hard 400 rather than a degraded answer.
    expect(groqDescriptor.capabilities.jsonStrategy).toBe('json-object');
    expect(groqDescriptor.capabilities.json).toBe('per-model');
  });
});

describe('Groq — every failure type', () => {
  async function failWith(status: number, body: string, headers: HeadersInit = {}) {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(new Response(body, { status, statusText: 'x', headers }));
    const events = await collect(
      createGroqProvider({ apiKey: 'k', fetchImpl }).stream(
        REQUEST,
        new AbortController().signal,
      ),
    );
    return events.find((e) => e.type === 'error') as Extract<ProviderEvent, { type: 'error' }>;
  }

  it('invalid key — 401 is not retryable', async () => {
    const error = await failWith(401, '{"error":{"message":"Invalid API Key"}}');
    expect(error.retryable).toBe(false);
    expect(describeProviderFailure({ providerCode: error.providerCode, detail: error.message }).category).toBe(
      'invalid-api-key',
    );
  });

  it('quota exceeded — 429 carries the rate-limit facts', async () => {
    const error = await failWith(429, '{"error":{"message":"Rate limit reached"}}', {
      'retry-after': '12',
      'x-ratelimit-remaining-requests': '0',
    });
    expect(error.retryable).toBe(true);
    expect(error.rateLimit?.retryAfterSeconds).toBe(12);
    expect(error.rateLimit?.remaining).toBe(0);
  });

  it('model unavailable — 404 says the catalogue changes', async () => {
    const error = await failWith(404, '{"error":{"message":"model not found"}}');
    expect(error.message).toMatch(/does not serve a model called/i);
  });

  it('payload too large — 413 suggests a smaller scope', async () => {
    const error = await failWith(413, '{"error":{"message":"too large"}}');
    expect(error.message).toMatch(/smaller repair scope/i);
  });

  it('network failure — never reached the provider', async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new TypeError('fetch failed'));
    const events = await collect(
      createGroqProvider({ apiKey: 'k', fetchImpl }).stream(
        REQUEST,
        new AbortController().signal,
      ),
    );
    expect(events[0]).toMatchObject({ type: 'error', providerCode: 'NETWORK', retryable: true });
  });
});

describe('Groq — failover eligibility follows the shared policy', () => {
  const candidate = { provider: 'groq', model: 'llama-3.3-70b-versatile', local: false };

  it('fails over for availability failures', () => {
    for (const code of ['HTTP_429', 'HTTP_500', 'HTTP_503']) {
      expect(
        shouldFailover(describeProviderFailure({ providerCode: code, detail: 'x' }), candidate),
        code,
      ).toBe(true);
    }
  });

  it('does NOT fail over for a rejected credential or an oversized prompt', () => {
    for (const code of ['HTTP_401', 'HTTP_403', 'HTTP_413']) {
      expect(
        shouldFailover(describeProviderFailure({ providerCode: code, detail: 'x' }), candidate),
        code,
      ).toBe(false);
    }
  });
});
