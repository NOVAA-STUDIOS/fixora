import { NextRequest } from 'next/server'

const MODELS: Record<string, string> = {
  gemini: 'gemini-3.6-flash',
  openai: 'gpt-4o-mini',
  openrouter: 'google/gemini-2.0-flash-exp:free',
  anthropic: 'claude-sonnet-4-6',
}

export async function POST(req: NextRequest) {
  const { prompt, messages = [], apiKey, provider = 'gemini' } = await req.json() as {
    prompt: string
    messages: Array<{ role: string; content: string }>
    apiKey: string
    provider: string
  }
  if (!apiKey) return new Response('API key required', { status: 401 })
  if (!prompt) return new Response('Prompt required', { status: 400 })

  const model = MODELS[provider] ?? MODELS.gemini!
  const systemPrompt = 'You are Zappr, an expert AI coding assistant by Fixora (NOVAA Studios). Help the user fix, explain, and create code. Be concise and use markdown with code blocks.'

  // The conversation so far (already includes the latest user turn — the client appends it
  // before sending), converted into each provider's own history shape.
  const history = messages.length > 0 ? messages : [{ role: 'user', content: prompt }]

  let url: string
  let headers: Record<string, string>
  let body: unknown

  if (provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`
    headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }
    body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    }
  } else if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages'
    headers = { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    body = {
      model,
      messages: history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      system: systemPrompt,
      stream: true,
      max_tokens: 4096,
    }
  } else {
    const baseUrl = provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1'
    url = `${baseUrl}/chat/completions`
    headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }
    body = {
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...history.map(m => ({ role: m.role, content: m.content }))],
      stream: true,
    }
  }

  const upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!upstream.ok) return new Response(await upstream.text(), { status: upstream.status })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data) as Record<string, unknown>
            let text = ''
            if (provider === 'gemini') {
              const candidates = (parsed.candidates as Array<{ content: { parts: Array<{ text: string }> } }>) ?? []
              text = candidates[0]?.content?.parts[0]?.text ?? ''
            } else if (provider === 'anthropic') {
              const delta = (parsed as { delta?: { text?: string } }).delta
              text = delta?.text ?? ''
            } else {
              const choices = (parsed.choices as Array<{ delta: { content: string } }>) ?? []
              text = choices[0]?.delta?.content ?? ''
            }
            if (text) controller.enqueue(encoder.encode(text))
          } catch { /* skip */ }
        }
      }
      controller.close()
    }
  })

  return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
