import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleZapprRequest } from './proxy-handler'

let nextClientId = 1

function createRequest(
  body: unknown,
  options: { ip?: string; origin?: string; contentType?: string; raw?: string; extraHeaders?: Record<string, string> } = {},
) {
  const headers = new Headers({
    'content-type': options.contentType ?? 'application/json',
    'x-real-ip': options.ip ?? `test-client-${nextClientId++}`,
    ...options.extraHeaders,
  })
  if (options.origin !== undefined) headers.set('origin', options.origin)
  return new Request('https://fixora.test/api/zappr', {
    method: 'POST',
    headers,
    body: options.raw ?? JSON.stringify(body),
  })
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    prompt: 'Explain this code.',
    messages: [{ role: 'user', content: 'Explain this code.' }],
    apiKey: 'test-provider-key',
    provider: 'gemini',
    ...overrides,
  }
}

function sseResponse(chunks: string[], init: ResponseInit = {}) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  const headers = new Headers(init.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'text/event-stream; charset=utf-8')
  return new Response(body, { ...init, headers })
}

test('supported provider streams normally for a same-origin request', async () => {
  let upstreamUrl = ''
  let upstreamKey = ''
  let redirectPolicy: RequestRedirect | undefined
  const request = createRequest(payload({ provider: 'openai' }), { origin: 'https://fixora.test' })
  const result = await handleZapprRequest(request, {
    fetcher: async (input, init) => {
      upstreamUrl = String(input)
      upstreamKey = new Headers(init?.headers).get('authorization') ?? ''
      redirectPolicy = init?.redirect
      return sseResponse(['data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n', 'data: [DONE]\n\n'])
    },
  })

  assert.equal(result.status, 200)
  assert.equal(upstreamUrl, 'https://api.openai.com/v1/chat/completions')
  assert.equal(upstreamKey, 'Bearer test-provider-key')
  assert.equal(redirectPolicy, 'error')
  assert.equal(await result.text(), 'Hello')
  assert.equal(result.headers.get('cache-control'), 'no-store, max-age=0')
})

test('unknown providers are rejected and renderer endpoint fields cannot select a URL', async () => {
  let called = false
  const fetcher: typeof fetch = async input => {
    called = true
    assert.equal(String(input), 'https://api.openai.com/v1/chat/completions')
    return sseResponse([])
  }

  const unknown = await handleZapprRequest(createRequest(payload({ provider: 'attacker', baseUrl: 'https://evil.test' })), { fetcher })
  assert.equal(unknown.status, 400)
  assert.equal(called, false)

  const allowed = await handleZapprRequest(createRequest(payload({ provider: 'openai', baseUrl: 'https://evil.test' })), { fetcher })
  assert.equal(allowed.status, 200)
  await allowed.text()
  assert.equal(called, true)
})

test('empty and oversized API keys are rejected without forwarding', async () => {
  let calls = 0
  const fetcher: typeof fetch = async () => { calls += 1; return sseResponse([]) }

  assert.equal((await handleZapprRequest(createRequest(payload({ apiKey: '  ' })), { fetcher })).status, 401)
  assert.equal((await handleZapprRequest(createRequest(payload({ apiKey: 'k'.repeat(8_193) })), { fetcher })).status, 400)
  assert.equal(calls, 0)
})

test('prompt, message count, individual content, and raw body limits are enforced', async () => {
  const fetcher: typeof fetch = async () => sseResponse([])
  assert.equal((await handleZapprRequest(createRequest(payload({ prompt: 'p'.repeat(100_001) })), { fetcher })).status, 400)
  assert.equal((await handleZapprRequest(createRequest(payload({ messages: Array.from({ length: 41 }, () => ({ role: 'user', content: 'x' })) })), { fetcher })).status, 400)
  assert.equal((await handleZapprRequest(createRequest(payload({ messages: [{ role: 'assistant', content: 'm'.repeat(100_001) }] })), { fetcher })).status, 400)

  const oversized = await handleZapprRequest(createRequest(null, { raw: 'x'.repeat(1_048_577) }), { fetcher })
  assert.equal(oversized.status, 413)
})

test('malformed JSON, wrong content type, and foreign origins are rejected safely', async () => {
  const getRequest = new Request('https://fixora.test/api/zappr', { method: 'GET' })
  assert.equal((await handleZapprRequest(getRequest)).status, 405)

  const malformed = await handleZapprRequest(createRequest(null, { raw: '{not json' }))
  assert.equal(malformed.status, 400)
  assert.equal(await malformed.text(), 'Malformed JSON request.')

  const wrongType = await handleZapprRequest(createRequest(payload(), { contentType: 'text/plain' }))
  assert.equal(wrongType.status, 415)

  const foreignOrigin = await handleZapprRequest(createRequest(payload(), { origin: 'https://attacker.test' }))
  assert.equal(foreignOrigin.status, 403)

  const foreignHost = await handleZapprRequest(createRequest(payload(), {
    origin: 'https://fixora.test',
    extraHeaders: { host: 'attacker.test' },
  }))
  assert.equal(foreignHost.status, 403)
})

test('server-side client rate limit returns 429 and ignores caller counters', async () => {
  const ip = `rate-test-${nextClientId++}`
  const fetcher: typeof fetch = async () => sseResponse([])

  for (let index = 0; index < 20; index += 1) {
    const allowed = await handleZapprRequest(createRequest(payload(), {
      ip,
      extraHeaders: { 'x-rate-limit-count': '0' },
    }), { fetcher })
    assert.equal(allowed.status, 200)
    await allowed.text()
  }

  const limited = await handleZapprRequest(createRequest(payload(), {
    ip,
    extraHeaders: { 'x-rate-limit-count': '0' },
  }), { fetcher })
  assert.equal(limited.status, 429)
  assert.ok(Number(limited.headers.get('retry-after')) > 0)
})

test('upstream timeout is normalized and responses are not cacheable', async () => {
  const request = createRequest(payload())
  const result = await handleZapprRequest(request, {
    timeoutMs: 5,
    fetcher: (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('timeout leaked test-provider-key')), { once: true })
    }),
  })

  assert.equal(result.status, 504)
  const errorText = await result.text()
  assert.equal(errorText, 'Provider request timed out.')
  assert.equal(result.headers.get('cache-control'), 'no-store, max-age=0')
  assert.doesNotMatch(errorText, /test-provider-key/)
})

test('provider errors do not expose upstream body, headers, or API key', async () => {
  const result = await handleZapprRequest(createRequest(payload()), {
    fetcher: async () => new Response('provider echoed test-provider-key', {
      status: 401,
      headers: { 'set-cookie': 'secret=bad', 'cache-control': 'public, max-age=3600' },
    }),
  })

  assert.equal(result.status, 502)
  assert.equal(await result.text(), 'Provider request failed.')
  assert.equal(result.headers.get('set-cookie'), null)
  assert.equal(result.headers.get('cache-control'), 'no-store, max-age=0')
})

test('non-event-stream provider success is treated as an invalid upstream response', async () => {
  const result = await handleZapprRequest(createRequest(payload()), {
    fetcher: async () => new Response('<html>test-provider-key</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
  })

  assert.equal(result.status, 502)
  assert.equal(await result.text(), 'Provider returned an invalid response.')
})

test('split and malformed SSE frames are ignored safely while valid content streams', async () => {
  const result = await handleZapprRequest(createRequest(payload({ provider: 'openai' })), {
    fetcher: async () => sseResponse([
      'data: {malformed}\n\n',
      'data: {"choices":[{"delta":{"content":"frag',
      'mented"}}]}\r\n\r\n',
      'data: [DONE]\n\n',
    ]),
  })

  assert.equal(result.status, 200)
  assert.equal(await result.text(), 'fragmented')
})
