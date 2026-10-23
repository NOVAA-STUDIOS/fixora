import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  createChatExport,
  createSharePayload,
  createZapprRequestBody,
  loadSavedProvider,
  redactApiKey,
  redactStreamingApiKey,
  saveProviderPreference,
  type WebChatMessage,
} from './web-session'

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => { values.delete(key) },
  }
}

test('legacy API key is removed and provider preference remains persistent', () => {
  const storage = createStorage({ fixora_api_key: 'legacy-secret', fixora_provider: 'openai' })

  assert.equal(loadSavedProvider(storage), 'openai')
  saveProviderPreference(storage, 'anthropic')

  assert.equal(storage.values.get('fixora_provider'), 'anthropic')
  assert.equal(storage.values.has('fixora_api_key'), false)
})

test('refresh initialization has no restored API key or sessionStorage credential path', async () => {
  const pageSource = await readFile(new URL('./page.tsx', import.meta.url), 'utf8')

  assert.match(pageSource, /useState\(''\)/)
  assert.doesNotMatch(pageSource, /sessionStorage/)
  assert.doesNotMatch(pageSource, /localStorage\.(?:getItem|setItem)\(['"]fixora_api_key/)
})

test('chat request includes only the currently supplied in-memory API key separately from history', () => {
  const message: WebChatMessage = { role: 'user', content: 'hello' }
  const body = createZapprRequestBody({ prompt: 'hello', messages: [message], apiKey: 'session-secret', provider: 'openai' })

  assert.equal(body.apiKey, 'session-secret')
  assert.equal(JSON.stringify(body.messages).includes('session-secret'), false)
})

test('share payload and export redact a key echoed into message content', () => {
  const messages: WebChatMessage[] = [{ role: 'assistant', content: 'answer session-secret' }]
  const share = createSharePayload(messages, 'openai', '2026-10-04T00:00:00.000Z', 'session-secret')
  const exported = createChatExport(messages, '10/4/2026', 'session-secret')

  assert.deepEqual(Object.keys(share).sort(), ['messages', 'provider', 'sharedAt'])
  assert.equal(JSON.stringify(share).includes('session-secret'), false)
  assert.equal(exported.includes('session-secret'), false)
})

test('API keys are redacted from response, streaming, and error text before display/history', () => {
  const apiKey = 'session-secret-key'

  assert.equal(redactApiKey(`Error echoed ${apiKey}`, apiKey), 'Error echoed [redacted]')
  assert.equal(redactStreamingApiKey(`response ${apiKey.slice(0, 7)}`, apiKey), 'response ')
  assert.equal(redactStreamingApiKey(`response ${apiKey}`, apiKey), 'response [redacted]')
})
