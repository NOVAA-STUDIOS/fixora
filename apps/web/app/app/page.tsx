'use client'
import { useState, useRef, useEffect } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'

type Message = { role: 'user' | 'assistant'; content: string }

const markdownComponents: Components = {
  code: ({ className, children }) => {
    const isBlock = className?.startsWith('language-') === true
    if (isBlock) {
      const highlighted = hljs.highlightAuto(String(children)).value
      return (
        <pre style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '16px 20px', overflowX: 'auto', fontSize: 13, fontFamily: '"JetBrains Mono", monospace', margin: '12px 0', lineHeight: 1.7 }}>
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
      )
    }
    return <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: 5, fontSize: 12, fontFamily: '"JetBrains Mono", monospace', color: '#a78bfa' }}>{children}</code>
  },
}

export default function AppPage() {
  const [apiKey, setApiKey] = useState('')
  const [provider, setProvider] = useState('gemini')
  const [prompt, setPrompt] = useState('')
  const [code, setCode] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [loading, setLoading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const responseRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const saved = localStorage.getItem('fixora_api_key')
    const savedProvider = localStorage.getItem('fixora_provider')
    if (saved) setApiKey(saved)
    if (savedProvider) setProvider(savedProvider)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setTheme(mq.matches ? 'dark' : 'light')
    const handler = (e: MediaQueryListEvent) => setTheme(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const saveSettings = () => {
    localStorage.setItem('fixora_api_key', apiKey)
    localStorage.setItem('fixora_provider', provider)
    setShowSettings(false)
  }

  const run = async () => {
    if (!prompt.trim()) return
    if (!apiKey && provider !== 'ollama') { setShowSettings(true); return }

    const userMessage: Message = { role: 'user', content: prompt + (code ? `\n\n\`\`\`\n${code}\n\`\`\`` : '') }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setPrompt('')
    setCode('')
    setStreamingText('')
    setLoading(true)

    try {
      const res = await fetch('/api/zappr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userMessage.content, messages: newMessages, apiKey, provider })
      })
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) throw new Error('No response body')
      let fullText = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        fullText += chunk
        setStreamingText(fullText)
        if (responseRef.current) responseRef.current.scrollTop = responseRef.current.scrollHeight
      }
      setMessages(prev => [...prev, { role: 'assistant', content: fullText }])
      setStreamingText('')
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + String(e) }])
      setStreamingText('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: theme === 'dark' ? 'linear-gradient(160deg, #0a0a0f 0%, #080808 50%, #0a080f 100%)' : 'linear-gradient(160deg, #f8f8f8 0%, #ffffff 50%, #f5f5ff 100%)', color: theme === 'dark' ? '#f0f0f0' : '#111', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif' }}>
      <style>{`
        :root {
          --bg: ${theme === 'dark' ? '#080808' : '#f8f8f8'};
          --surface: ${theme === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)'};
          --border: ${theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'};
          --text: ${theme === 'dark' ? '#f0f0f0' : '#111'};
          --text-muted: ${theme === 'dark' ? '#555' : '#888'};
          --user-bubble: ${theme === 'dark' ? 'rgba(124,58,237,0.12)' : 'rgba(124,58,237,0.08)'};
        }
      `}</style>

      {/* Header */}
      <div style={{ padding: '14px 24px', borderBottom: theme === 'dark' ? '1px solid rgba(255,255,255,0.05)' : '1px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <img src="/fixora-icon.png" alt="Fixora" style={{ width: 32, height: 32, borderRadius: 10, objectFit: 'cover' }} />
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em', color: theme === 'dark' ? '#f0f0f0' : '#111' }}>Fixora</span>
        <span style={{ fontSize: 12, color: theme === 'dark' ? '#3a3a3a' : '#666' }}>· Zappr AI</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {messages.length > 0 && (
            <button onClick={() => { setMessages([]); setStreamingText(''); setCode('') }} style={{ fontSize: 12, color: '#555', padding: '6px 14px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', cursor: 'pointer' }}>
              New Chat
            </button>
          )}
          <button
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            style={{ fontSize: 16, padding: '6px 10px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', cursor: 'pointer', lineHeight: 1 }}
            title="Toggle theme"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <a href="/" style={{ fontSize: 12, color: '#444', textDecoration: 'none', padding: '6px 14px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>← Home</a>
          <button onClick={() => setShowSettings(true)} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: (apiKey || provider === 'ollama') ? '#4ade80' : '#f59e0b' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: (apiKey || provider === 'ollama') ? '#4ade80' : '#f59e0b', display: 'inline-block' }} />
            {(apiKey || provider === 'ollama') ? 'Connected' : 'Setup API Key'}
          </button>
        </div>
      </div>

      {/* Settings modal */}
      {showSettings && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: '#111116', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 24, padding: 28, width: 380, boxShadow: '0 32px 64px rgba(0,0,0,0.6)' }}>
            <h3 style={{ margin: '0 0 20px', fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }}>Settings</h3>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 8, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Provider</label>
              <select value={provider} onChange={e => setProvider(e.target.value)} style={{ width: '100%', padding: '11px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, color: '#f0f0f0', fontSize: 14, outline: 'none' }}>
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI</option>
                <option value="openrouter">OpenRouter (Free models)</option>
                <option value="anthropic">Anthropic Claude</option>
                <option value="ollama">Ollama (Local)</option>
              </select>
            </div>
            {provider !== 'ollama' ? (
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 8, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>API Key</label>
                <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Paste your API key..." style={{ width: '100%', padding: '11px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, color: '#f0f0f0', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
              </div>
            ) : (
              <div style={{ marginBottom: 20, padding: '12px 14px', background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.15)', borderRadius: 12 }}>
                <p style={{ margin: 0, fontSize: 13, color: '#4ade80', lineHeight: 1.5 }}>✓ Connects to Ollama at localhost:11434 — no key needed</p>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={saveSettings} style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #7c3aed, #5b21b6)', border: 'none', borderRadius: 12, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Save</button>
              <button onClick={() => setShowSettings(false)} style={{ padding: '12px 18px', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, color: '#666', cursor: 'pointer', fontSize: 14 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Chat area — full width */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', maxWidth: 800, width: '100%', margin: '0 auto', padding: '0 20px', minHeight: 0 }}>

        {/* Messages */}
        <div ref={responseRef} style={{ flex: 1, overflowY: 'scroll', scrollbarWidth: 'none', padding: '20px 0 12px', minHeight: 0 }}>
          {messages.length === 0 && !loading && (
            <div style={{ textAlign: 'center', marginTop: 40 }}>
              <img src="/zappr-mascot.png" alt="Zappr" style={{ width: 64, height: 64, borderRadius: 20, objectFit: 'contain', margin: '0 auto 20px', display: 'block' }} />
              <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', color: theme === 'dark' ? '#e0e0e0' : '#111' }}>How can Zappr help?</h2>
              <p style={{ margin: 0, fontSize: 14, color: theme === 'dark' ? '#333' : '#666', lineHeight: 1.6 }}>Fix bugs · Explain code · Create components · Add types</p>

              {/* Suggestion cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 20, textAlign: 'left' }}>
                {[
                  { icon: '🔧', title: 'Fix my code', desc: 'Paste code and describe the bug' },
                  { icon: '📖', title: 'Explain this', desc: 'Understand complex code instantly' },
                  { icon: '✨', title: 'Create a component', desc: 'Generate React, Vue, or vanilla JS' },
                  { icon: '🧪', title: 'Write tests', desc: 'Unit tests for your functions' },
                ].map(s => (
                  <button key={s.title} onClick={() => setPrompt(s.title)} style={{ padding: '12px 14px', background: theme === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)', border: theme === 'dark' ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(0,0,0,0.08)', borderRadius: 14, cursor: 'pointer', textAlign: 'left', animation: 'slideUp 0.4s ease' }}>
                    <div style={{ fontSize: 18, marginBottom: 6 }}>{s.icon}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: theme === 'dark' ? '#c0c0c0' : '#222', marginBottom: 3 }}>{s.title}</div>
                    <div style={{ fontSize: 12, color: theme === 'dark' ? '#3a3a3a' : '#666' }}>{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} style={{ marginBottom: 24, display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 12, alignItems: 'flex-start' }}>
              {msg.role === 'assistant' && (
                <img src="/zappr-mascot.png" alt="Zappr" style={{ width: 32, height: 32, borderRadius: 10, objectFit: 'contain', flexShrink: 0 }} />
              )}
              <div style={{ maxWidth: '85%' }}>
                {msg.role === 'user' ? (
                  <div style={{ padding: '12px 16px', background: theme === 'dark' ? 'rgba(124,58,237,0.12)' : 'rgba(124,58,237,0.08)', border: theme === 'dark' ? '1px solid rgba(124,58,237,0.2)' : '1px solid rgba(124,58,237,0.15)', borderRadius: '16px 16px 4px 16px', fontSize: 14, color: theme === 'dark' ? '#e0e0e0' : '#1a1a1a', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                ) : (
                  <div style={{ fontSize: 14, lineHeight: 1.75, color: '#d0d0d0', animation: 'fadeIn 0.3s ease' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#a78bfa', marginBottom: 8 }}>Zappr · {provider}</div>
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>{msg.content}</ReactMarkdown>
                    {i === messages.length - 1 && (
                      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                        <button onClick={() => navigator.clipboard.writeText(msg.content).catch(() => null)} style={{ padding: '5px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 20, fontSize: 11, color: '#555', cursor: 'pointer' }}>Copy</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Streaming text */}
          {streamingText && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 24 }}>
              <img src="/zappr-mascot.png" alt="Zappr" style={{ width: 32, height: 32, borderRadius: 10, objectFit: 'contain', flexShrink: 0 }} />
              <div style={{ flex: 1, fontSize: 14, lineHeight: 1.75, color: '#d0d0d0' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#a78bfa', marginBottom: 8 }}>Zappr · {provider}</div>
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>{streamingText}</ReactMarkdown>
                <span style={{ display: 'inline-block', width: 2, height: 14, background: '#7c3aed', borderRadius: 2, marginLeft: 2, animation: 'blink 1s step-end infinite', verticalAlign: 'middle' }} />
              </div>
            </div>
          )}

          {loading && !streamingText && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
              <img src="/zappr-mascot.png" alt="Zappr" style={{ width: 32, height: 32, borderRadius: 10, objectFit: 'contain', flexShrink: 0 }} />
              <div style={{ fontSize: 13, color: '#444' }}>Thinking...</div>
            </div>
          )}
        </div>

        {/* Input area */}
        <div style={{ paddingBottom: 24, flexShrink: 0 }}>
          {code && (
            <div style={{ marginBottom: 8, padding: '8px 14px', background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.15)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: '#a78bfa' }}>📄 Code attached ({code.split('\n').length} lines)</span>
              <button onClick={() => setCode('')} style={{ marginLeft: 'auto', fontSize: 11, color: '#555', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
            </div>
          )}

          <div style={{ background: theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', border: theme === 'dark' ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.08)', borderRadius: 28, display: 'flex', alignItems: 'flex-end', gap: 8, padding: '8px 8px 8px 16px', boxShadow: '0 4px 24px rgba(0,0,0,0.3)' }}>

            {/* Attach button */}
            <label style={{ cursor: 'pointer', padding: '6px', borderRadius: 8, display: 'flex', alignItems: 'center', color: '#444', flexShrink: 0, marginBottom: 2 }} title="Attach code file">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              <input type="file" accept=".ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.cpp,.c,.html,.css,.json" onChange={e => {
                const file = e.target.files?.[0]
                if (file) { const reader = new FileReader(); reader.onload = ev => setCode(String(ev.target?.result ?? '')); reader.readAsText(file) }
              }} style={{ display: 'none' }} />
            </label>

            {/* Textarea */}
            <textarea
              value={prompt}
              onChange={e => {
                setPrompt(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'
              }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void run() } }}
              placeholder="Message Zappr..."
              rows={1}
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '6px 0', color: theme === 'dark' ? '#f0f0f0' : '#111', fontSize: 15, resize: 'none', fontFamily: 'inherit', lineHeight: 1.6, maxHeight: 200, overflowY: 'auto', scrollbarWidth: 'none' }}
            />

            {/* Send button */}
            <button
              onClick={() => void run()}
              disabled={loading || !prompt.trim()}
              style={{ width: 36, height: 36, borderRadius: 20, background: loading || !prompt.trim() ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #7c3aed, #5b21b6)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: loading || !prompt.trim() ? 'not-allowed' : 'pointer', flexShrink: 0, boxShadow: loading || !prompt.trim() ? 'none' : '0 4px 12px rgba(124,58,237,0.4)', transition: 'all 0.2s' }}
            >
              {loading
                ? <span style={{ width: 14, height: 14, border: '2px solid #444', borderTopColor: '#888', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              }
            </button>
          </div>
          <p style={{ textAlign: 'center', fontSize: 11, color: theme === 'dark' ? '#2a2a2a' : '#999', marginTop: 10, marginBottom: 0 }}>Fixora can make mistakes. Verify important code.</p>
        </div>
      </div>
    </div>
  )
}
