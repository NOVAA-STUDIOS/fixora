import { describe, expect, it } from 'vitest';

import { createAnthropicProvider, toAnthropicBody } from './adapters/anthropic.js';
import type { FetchLike } from './adapters/openai-compatible.js';
import { shouldFailover } from './failover.js';
import { describeProviderFailure } from './failure.js';
import type { ProviderEvent, ProviderRequest } from './types.js';

/**
 * Anthropic — the first adapter that is not OpenAI-compatible.
 *
 * The property that matters most is invisibility: it emits the SAME `ProviderEvent` stream as every
 * other adapter, so nothing above it can tell which provider answered. Everything below tests that
 * equivalence, plus the four structural differences that would otherwise fail silently — the system
 * split, the required `max_tokens`, the typed SSE frames, and the header auth.
 */
const REQUEST: ProviderRequest = {
  model: 'claude-sonnet-4-5',
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

describe('Anthropic — request shaping', () => {
  it('lifts system messages to the top-level field, which Anthropic requires', () => {
    // `role: 'system'` in the messages array is a 400. The split happens here so the prompt builder
    // stays provider-blind.
    const body = toAnthropicBody(REQUEST, 4096);
    expect(body['system']).toBe('You are a repair engine.');
    expect(body['messages']).toEqual([{ role: 'user', content: 'fix this' }]);
  });

  it('always sends max_tokens — omitting it is a hard 400', () => {
    expect(toAnthropicBody(REQUEST, 4096)['max_tokens']).toBe(4096);
    expect(toAnthropicBody({ ...REQUEST, maxOutputTokens: 512 }, 4096)['max_tokens']).toBe(512);
  });

  it('omits system entirely when there is none, rather than sending an empty string', () => {
    const body = toAnthropicBody({ model: 'm', messages: [{ role: 'user', content: 'x' }] }, 100);
    expect(body).not.toHaveProperty('system');
  });

  it('authenticates with x-api-key and the version header, not a bearer token', async () => {
    let seen: Record<string, string> = {};
    const fetchImpl: FetchLike = (_url, init) => {
      seen = (init.headers ?? {}) as Record<string, string>;
      return Promise.resolve(sse(['data: {"type":"message_stop"}\n']));
    };
    await collect(
      createAnthropicProvider({ apiKey: 'sk-ant-test', fetchImpl }).stream(
        REQUEST,
        new AbortController().signal,
      ),
    );
    expect(seen['x-api-key']).toBe('sk-ant-test');
    expect(seen['anthropic-version']).toBe('2023-06-01');
    expect(seen['Authorization']).toBeUndefined();
  });
});

describe('Anthropic — success path yields the same events as every other adapter', () => {
  it('turns typed content_block_delta frames into text deltas, and reports usage', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        sse([
          'data: {"type":"message_start","message":{"usage":{"input_tokens":11}}}\n',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"const "}}\n',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"a = 1;"}}\n',
          'data: {"type":"message_delta","usage":{"output_tokens":7}}\n',
          'data: {"type":"message_stop"}\n',
        ]),
      );
    const events = await collect(
      createAnthropicProvider({ apiKey: 'k', fetchImpl }).stream(
        REQUEST,
        new AbortController().signal,
      ),
    );

    expect(events.filter((e) => e.type === 'text_delta').map((e) => (e as { text: string }).text)).toEqual([
      'const ',
      'a = 1;',
    ]);
    // Usage is split across two frame types; both halves must survive.
    expect(events.find((e) => e.type === 'usage')).toEqual({
      type: 'usage',
      inputTokens: 11,
      outputTokens: 7,
      cachedTokens: 0,
    });
  });

  it('ignores frame types it does not handle rather than erroring', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        sse([
          'data: {"type":"content_block_start","index":0}\n',
          'data: {"type":"ping"}\n',
          ': keep-alive comment\n',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n',
        ]),
      );
    const events = await collect(
      createAnthropicProvider({ apiKey: 'k', fetchImpl }).stream(
        REQUEST,
        new AbortController().signal,
      ),
    );
    expect(events).toEqual([{ type: 'text_delta', text: 'ok' }]);
  });
});

describe('Anthropic — every failure type', () => {
  async function failWith(status: number, body: string, headers: Record<string, string> = {}) {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(new Response(body, { status, statusText: 'x', headers }));
    const events = await collect(
      createAnthropicProvider({ apiKey: 'k', fetchImpl }).stream(
        REQUEST,
        new AbortController().signal,
      ),
    );
    return events.find((e) => e.type === 'error') as Extract<ProviderEvent, { type: 'error' }>;
  }

  it('invalid key — 401, not retryable, and classified as a credential problem', async () => {
    const error = await failWith(
      401,
      '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    );
    expect(error.providerCode).toBe('HTTP_401');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('invalid x-api-key');
    const failure = describeProviderFailure({ providerCode: error.providerCode, detail: error.message });
    expect(failure.category).toBe('invalid-api-key');
  });

  it('quota exceeded — 429 carries the rate-limit facts through', async () => {
    const error = await failWith(
      429,
      '{"type":"error","error":{"type":"rate_limit_error","message":"rate limit exceeded"}}',
      { 'retry-after': '30', 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '1000' },
    );
    expect(error.retryable).toBe(true);
    expect(error.rateLimit?.remaining).toBe(0);
    expect(error.rateLimit?.limit).toBe(1000);
    expect(error.rateLimit?.retryAfterSeconds).toBe(30);
  });

  it('model unavailable — 404 explains that ids change between generations', async () => {
    const error = await failWith(404, '{"error":{"message":"model not found"}}');
    expect(error.message).toMatch(/no model called "claude-sonnet-4-5"/i);
  });

  it('overloaded — 529 is Anthropic-specific and reported as temporary', async () => {
    const error = await failWith(529, '{"error":{"message":"overloaded"}}');
    expect(error.retryable).toBe(true);
    expect(error.message).toMatch(/overloaded/i);
  });

  it('network failure — never reached the provider', async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new TypeError('fetch failed'));
    const events = await collect(
      createAnthropicProvider({ apiKey: 'k', fetchImpl }).stream(
        REQUEST,
        new AbortController().signal,
      ),
    );
    expect(events).toEqual([
      { type: 'error', retryable: true, providerCode: 'NETWORK', message: 'TypeError' },
    ]);
  });

  it('a cancelled stream is silence, not an error', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl: FetchLike = () => Promise.reject(new Error('aborted'));
    const events = await collect(
      createAnthropicProvider({ apiKey: 'k', fetchImpl }).stream(REQUEST, controller.signal),
    );
    expect(events).toEqual([]);
  });
});

describe('Anthropic — failover eligibility follows the shared policy', () => {
  const candidate = { provider: 'anthropic', model: 'claude-sonnet-4-5', local: false };

  it('fails over for 429, 500 and 529', () => {
    for (const code of ['HTTP_429', 'HTTP_500', 'HTTP_529']) {
      const failure = describeProviderFailure({ providerCode: code, detail: 'x' });
      expect(shouldFailover(failure, candidate), code).toBe(true);
    }
  });

  it('does NOT fail over for 401 or 403 — every candidate rejects the same key', () => {
    for (const code of ['HTTP_401', 'HTTP_403']) {
      const failure = describeProviderFailure({ providerCode: code, detail: 'x' });
      expect(shouldFailover(failure, candidate), code).toBe(false);
    }
  });
});

describe('Anthropic — test()', () => {
  it('reports unauthenticated for a rejected key without claiming the host is down', async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(new Response('{}', { status: 401 }));
    const result = await createAnthropicProvider({ apiKey: 'k', fetchImpl }).test(
      'claude-sonnet-4-5',
      new AbortController().signal,
    );
    expect(result).toMatchObject({ reachable: true, authenticated: false });
  });

  it('reports the model list and whether the configured model is in it', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-4-5' }, { id: 'other' }] }), {
          status: 200,
        }),
      );
    const result = await createAnthropicProvider({ apiKey: 'k', fetchImpl }).test(
      'claude-sonnet-4-5',
      new AbortController().signal,
    );
    expect(result.modelAvailable).toBe(true);
    expect(result.models).toEqual(['claude-sonnet-4-5', 'other']);
  });

  it('reports unreachable when nothing answered', async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error('ENOTFOUND'));
    const result = await createAnthropicProvider({ apiKey: 'k', fetchImpl }).test(
      'm',
      new AbortController().signal,
    );
    expect(result).toMatchObject({ reachable: false, authenticated: null });
  });
});
