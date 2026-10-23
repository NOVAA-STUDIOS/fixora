export type WebChatMessage = { role: 'user' | 'assistant'; content: string }

type ProviderStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const API_KEY_STORAGE_KEY = 'fixora_api_key'
const PROVIDER_STORAGE_KEY = 'fixora_provider'

export function loadSavedProvider(storage: ProviderStorage) {
  // Clear credentials written by older versions; keys are now page-session only.
  storage.removeItem(API_KEY_STORAGE_KEY)
  return storage.getItem(PROVIDER_STORAGE_KEY)
}

export function saveProviderPreference(storage: ProviderStorage, provider: string) {
  storage.setItem(PROVIDER_STORAGE_KEY, provider)
}

export function createZapprRequestBody(input: {
  prompt: string
  messages: WebChatMessage[]
  apiKey: string
  provider: string
}) {
  return input
}

export function createSharePayload(messages: WebChatMessage[], provider: string, sharedAt: string, apiKey: string) {
  return {
    messages: messages.map(({ role, content }) => ({ role, content: redactApiKey(content, apiKey) })),
    provider,
    sharedAt,
  }
}

export function createChatExport(messages: WebChatMessage[], exportedOn: string, apiKey: string) {
  const markdown = messages.map(message => {
    const content = redactApiKey(message.content, apiKey)
    if (message.role === 'user') return `## You\n\n${content}\n`
    return `## Zappr\n\n${content}\n`
  }).join('\n---\n\n')

  return `# Fixora Chat Export\n\n_Exported on ${exportedOn}_\n\n---\n\n${markdown}`
}

export function redactApiKey(text: string, apiKey: string) {
  return apiKey ? text.split(apiKey).join('[redacted]') : text
}

export function redactStreamingApiKey(text: string, apiKey: string) {
  const redacted = redactApiKey(text, apiKey)
  if (!apiKey) return redacted

  for (let length = Math.min(apiKey.length - 1, text.length); length > 0; length -= 1) {
    if (text.endsWith(apiKey.slice(0, length))) return redacted.slice(0, -length)
  }
  return redacted
}
