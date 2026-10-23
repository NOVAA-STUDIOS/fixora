type Provider = 'gemini' | 'openai' | 'openrouter' | 'anthropic'
type ChatMessage = { role: 'user' | 'assistant'; content: string }
type RequestPayload = { prompt: string; messages: ChatMessage[]; apiKey: string; provider: Provider }

const MODELS: Record<Provider, string> = {
  gemini: 'gemini-3.6-flash',
  openai: 'gpt-4o-mini',
  openrouter: 'google/gemini-2.0-flash-exp:free',
  anthropic: 'claude-sonnet-4-6',
}

const MAX_BODY_BYTES = 1_048_576
const MAX_TEXT_CHARS = 100_000
const MAX_MESSAGES = 40
const MAX_HISTORY_CHARS = 500_000
const MAX_API_KEY_CHARS = 8_192
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 10 * 60 * 1_000
const MAX_RATE_LIMIT_ENTRIES = 4_096
const UPSTREAM_TIMEOUT_MS = 60_000
const SYSTEM_PROMPT = 'You are Zappr, an expert AI coding assistant by Fixora (NOVAA Studios). Help the user fix, explain, and create code. Be concise and use markdown with code blocks.'
const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
}

// Best-effort per-process/per-instance limiting; use a trusted edge-provided client IP.
const clientWindows = new Map<string, { startedAt: number; count: number }>()

class PayloadTooLargeError extends Error {}

function response(body: BodyInit | null, status = 200, headers: HeadersInit = {}) {
  return new Response(body, {
    status,
    headers: { ...NO_CACHE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...Object.fromEntries(new Headers(headers)) },
  })
}

function originIsAllowed(request: Request) {
  const host = request.headers.get('host')
  const url = new URL(request.url)
  if (host && host.toLowerCase() !== url.host.toLowerCase()) return false

  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).origin === url.origin
  } catch {
    return false
  }
}

function consumeRateLimit(request: Request, now: number) {
  // Forwarding headers must be overwritten by the deployment's trusted edge proxy.
  const forwarded = request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]
  const client = forwarded?.trim() || 'unknown-client'

  for (const [key, entry] of clientWindows) {
    if (now - entry.startedAt >= RATE_WINDOW_MS) clientWindows.delete(key)
  }

  let entry = clientWindows.get(client)
  if (!entry || now - entry.startedAt >= RATE_WINDOW_MS) {
    entry = { startedAt: now, count: 0 }
    clientWindows.set(client, entry)
  }

  if (entry.count >= RATE_LIMIT) {
    return { limited: true, retryAfter: Math.max(1, Math.ceil((entry.startedAt + RATE_WINDOW_MS - now) / 1_000)) }
  }

  entry.count += 1
  clientWindows.delete(client)
  clientWindows.set(client, entry)
  while (clientWindows.size > MAX_RATE_LIMIT_ENTRIES) {
    const oldest = clientWindows.keys().next().value
    if (oldest === undefined) break
    clientWindows.delete(oldest)
  }
  return { limited: false, retryAfter: 0 }
}

async function readBoundedBody(request: Request) {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null) {
    const length = Number(declaredLength)
    if (!Number.isSafeInteger(length) || length < 0) throw new Error('invalid content length')
    if (length > MAX_BODY_BYTES) throw new PayloadTooLargeError()
  }

  if (!request.body) throw new Error('empty body')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {})
        throw new PayloadTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePayload(value: unknown): RequestPayload | string {
  if (!isRecord(value)) return 'Invalid request body.'

  const provider = value.provider === undefined ? 'gemini' : value.provider
  if (typeof provider !== 'string' || !Object.hasOwn(MODELS, provider)) return 'Unsupported provider.'

  if (typeof value.apiKey !== 'string' || value.apiKey.trim().length === 0) return 'API key required.'
  const apiKey = value.apiKey.trim()
  if (apiKey.length > MAX_API_KEY_CHARS) return 'API key is too long.'

  if (typeof value.prompt !== 'string' || value.prompt.trim().length === 0) return 'Prompt required.'
  if (value.prompt.length > MAX_TEXT_CHARS) return 'Prompt is too long.'

  const rawMessages = value.messages === undefined ? [] : value.messages
  if (!Array.isArray(rawMessages) || rawMessages.length > MAX_MESSAGES) return 'Conversation history is too large.'

  const messages: ChatMessage[] = []
  let historyChars = 0
  for (const message of rawMessages) {
    if (!isRecord(message) || (message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string') {
      return 'Invalid conversation history.'
    }
    if (message.content.length > MAX_TEXT_CHARS) return 'A conversation message is too long.'
    historyChars += message.content.length
    if (historyChars > MAX_HISTORY_CHARS) return 'Conversation history is too large.'
    messages.push({ role: message.role, content: message.content })
  }

  return { prompt: value.prompt, messages, apiKey, provider: provider as Provider }
}

function parseProviderText(provider: Provider, data: string) {
  if (data === '[DONE]') return ''
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return ''
  }
  if (!isRecord(parsed)) return ''

  if (provider === 'gemini') {
    const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : []
    const content = isRecord(candidates[0]) && isRecord(candidates[0].content) ? candidates[0].content : null
    const parts = content && Array.isArray(content.parts) ? content.parts : []
    return parts.map(part => isRecord(part) && typeof part.text === 'string' ? part.text : '').join('')
  }

  if (provider === 'anthropic') {
    const delta = isRecord(parsed.delta) ? parsed.delta : null
    return delta && typeof delta.text === 'string' ? delta.text : ''
  }

  const choices = Array.isArray(parsed.choices) ? parsed.choices : []
  const delta = isRecord(choices[0]) && isRecord(choices[0].delta) ? choices[0].delta : null
  return delta && typeof delta.content === 'string' ? delta.content : ''
}

async function forwardSse(body: ReadableStream<Uint8Array>, provider: Provider, destination: ReadableStreamDefaultController<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  const forwardFrame = (frame: string) => {
    const data = frame.split(/\r\n|\n|\r/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, ''))
      .join('\n')
    if (!data || data === '[DONE]') return
    const text = parseProviderText(provider, data)
    if (text) destination.enqueue(encoder.encode(text))
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })

      let match: RegExpMatchArray | null
      while ((match = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
        const boundaryIndex = match.index ?? 0
        const frame = buffer.slice(0, boundaryIndex)
        buffer = buffer.slice(boundaryIndex + match[0].length)
        forwardFrame(frame)
      }

      if (done) break
    }
    if (buffer.trim()) forwardFrame(buffer)
  } finally {
    reader.releaseLock()
  }
}

export async function handleZapprRequest(
  request: Request,
  options: { fetcher?: typeof fetch; timeoutMs?: number; now?: () => number } = {},
) {
  if (request.method !== 'POST') return response('Method not allowed.', 405, { Allow: 'POST' })
  if (!originIsAllowed(request)) return response('Request origin not allowed.', 403)

  const rate = consumeRateLimit(request, options.now?.() ?? Date.now())
  if (rate.limited) return response('Too many requests. Please try again later.', 429, { 'Retry-After': String(rate.retryAfter) })

  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return response('Content-Type must be application/json.', 415)
  }

  let bodyText: string
  try {
    bodyText = await readBoundedBody(request)
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return response('Request payload is too large.', 413)
    return response('Invalid request body.', 400)
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(bodyText)
  } catch {
    return response('Malformed JSON request.', 400)
  }

  const payload = parsePayload(decoded)
  if (typeof payload === 'string') {
    const status = payload === 'API key required.' ? 401 : 400
    return response(payload, status)
  }

  const { prompt, messages, apiKey, provider } = payload
  const model = MODELS[provider]
  const history = messages.length > 0 ? messages : [{ role: 'user' as const, content: prompt }]
  let url: string
  let headers: Record<string, string>
  let upstreamBody: unknown

  if (provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`
    headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }
    upstreamBody = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: history.map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })),
    }
  } else if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages'
    headers = { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    upstreamBody = {
      model,
      messages: history.map(message => ({ role: message.role, content: message.content })),
      system: SYSTEM_PROMPT,
      stream: true,
      max_tokens: 4096,
    }
  } else {
    const baseUrl = provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1'
    url = `${baseUrl}/chat/completions`
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
    upstreamBody = {
      model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history.map(message => ({ role: message.role, content: message.content }))],
      stream: true,
    }
  }

  const controller = new AbortController()
  let timedOut = false
  const abortForClient = () => controller.abort()
  if (request.signal.aborted) controller.abort()
  else request.signal.addEventListener('abort', abortForClient, { once: true })
  const cleanup = () => {
    clearTimeout(timeout)
    request.signal.removeEventListener('abort', abortForClient)
  }
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? UPSTREAM_TIMEOUT_MS)

  let upstream: Response
  try {
    upstream = await (options.fetcher ?? fetch)(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(upstreamBody),
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'error',
    })
  } catch {
    cleanup()
    if (request.signal.aborted) return response('Request cancelled.', 499)
    return response(timedOut ? 'Provider request timed out.' : 'Provider request failed.', timedOut ? 504 : 502)
  }

  if (!upstream.ok) {
    try { await upstream.body?.cancel() } catch { /* ignore upstream cleanup errors */ }
    cleanup()
    return response('Provider request failed.', 502)
  }
  const upstreamContentType = upstream.headers.get('content-type')?.toLowerCase()
  if (upstreamContentType && !upstreamContentType.startsWith('text/event-stream')) {
    try { await upstream.body?.cancel() } catch { /* ignore upstream cleanup errors */ }
    cleanup()
    return response('Provider returned an invalid response.', 502)
  }
  if (!upstream.body) {
    cleanup()
    return response('Provider returned an invalid response.', 502)
  }

  const stream = new ReadableStream<Uint8Array>({
    start(destination) {
      void forwardSse(upstream.body!, provider, destination)
        .then(() => destination.close())
        .catch(() => {
          try { destination.error(new Error(timedOut ? 'Provider request timed out.' : 'Provider stream failed.')) } catch { /* downstream closed */ }
        })
        .finally(cleanup)
    },
    cancel() {
      controller.abort()
      cleanup()
    },
  })

  return response(stream)
}
