'use client'
import { useState, useRef, useEffect } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

const markdownComponents: Components = {
  code: ({ className, children, ...props }) => {
    const isBlock = className?.startsWith('language-') === true
    return isBlock
      ? <pre style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '14px 16px', overflowX: 'auto', fontSize: 13, fontFamily: '"JetBrains Mono", monospace', margin: '12px 0' }}><code {...props}>{children}</code></pre>
      : <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: 5, fontSize: 12, fontFamily: '"JetBrains Mono", monospace', color: '#a78bfa' }} {...props}>{children}</code>
  },
}

export default function AppPage() {
  const [apiKey, setApiKey] = useState('')
  const [provider, setProvider] = useState('gemini')
  const [prompt, setPrompt] = useState('')
  const [code, setCode] = useState('')
  const [response, setResponse] = useState('')
  const [loading, setLoading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const responseRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const saved = localStorage.getItem('fixora_api_key')
    const savedProvider = localStorage.getItem('fixora_provider')
    if (saved) setApiKey(saved)
    if (savedProvider) setProvider(savedProvider)
  }, [])

  const saveSettings = () => {
    localStorage.setItem('fixora_api_key', apiKey)
    localStorage.setItem('fixora_provider', provider)
    setShowSettings(false)
  }

  const run = async () => {
    if (!prompt.trim()) return
    if (!apiKey && provider !== 'ollama') { setShowSettings(true); return }
    setLoading(true)
    setResponse('')
    try {
      const res = await fetch('/api/zappr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, code, apiKey, provider })
      })
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) throw new Error('No response body')
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        setResponse(prev => prev + chunk)
        if (responseRef.current) responseRef.current.scrollTop = responseRef.current.scrollHeight
      }
    } catch (e) {
      setResponse('Error: ' + String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'linear-gradient(160deg, #0a0a0f 0%, #080808 50%, #0a080f 100%)', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif' }}>

      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 12, backdropFilter: 'blur(20px)', background: 'rgba(8,8,8,0.8)' }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #7c3aed, #06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, boxShadow: '0 4px 12px rgba(124,58,237,0.4)' }}>⚡</div>
        <div>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em' }}>Fixora</span>
          <span style={{ fontSize: 12, color: '#555', marginLeft: 6 }}>Zappr AI</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <a href="/" style={{ fontSize: 12, color: '#555', textDecoration: 'none', padding: '6px 12px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.03)' }}>← Home</a>
          <button onClick={() => setShowSettings(true)} style={{ fontSize: 12, color: apiKey || provider === 'ollama' ? '#22c55e' : '#f59e0b', padding: '6px 14px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: apiKey || provider === 'ollama' ? '#22c55e' : '#f59e0b', display: 'inline-block' }}></span>
            {apiKey || provider === 'ollama' ? 'Connected' : 'Setup API Key'}
          </button>
        </div>
      </div>

      {/* Settings modal */}
      {showSettings && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, backdropFilter: 'blur(8px)' }}>
          <div style={{ background: 'rgba(18,18,24,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 24, padding: 28, width: 380, backdropFilter: 'blur(40px)', boxShadow: '0 32px 64px rgba(0,0,0,0.6)' }}>
            <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>⚙️ Settings</h3>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 8, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>AI Provider</label>
              <select value={provider} onChange={e => setProvider(e.target.value)} style={{ width: '100%', padding: '12px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#f0f0f0', fontSize: 14, outline: 'none' }}>
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI</option>
                <option value="openrouter">OpenRouter (Free)</option>
                <option value="anthropic">Anthropic Claude</option>
                <option value="ollama">Ollama (Local)</option>
              </select>
            </div>
            {provider !== 'ollama' && (
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 8, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>API Key</label>
                <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Paste your API key..." style={{ width: '100%', padding: '12px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#f0f0f0', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
              </div>
            )}
            {provider === 'ollama' && (
              <div style={{ marginBottom: 20, padding: '12px 14px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 12 }}>
                <p style={{ margin: 0, fontSize: 13, color: '#4ade80' }}>✓ No API key needed — connects to your local Ollama instance at localhost:11434</p>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={saveSettings} style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #7c3aed, #5b21b6)', border: 'none', borderRadius: 12, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', letterSpacing: '-0.01em' }}>Save Settings</button>
              <button onClick={() => setShowSettings(false)} style={{ padding: '12px 20px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, color: '#888', cursor: 'pointer', fontSize: 14 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, gap: 0 }}>

        {/* Left — Code editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(255,255,255,0.05)', minWidth: 0 }}>
          <div style={{ padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 10, color: '#3a3a3a', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Code · Optional</div>
          <textarea
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="// Paste your code here..."
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '20px', color: '#c9d1d9', fontSize: 13, fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", monospace', resize: 'none', lineHeight: 1.7 }}
          />
        </div>

        {/* Right — Zappr */}
        <div style={{ width: 440, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'rgba(255,255,255,0.01)' }}>

          {/* Response area */}
          <div ref={responseRef} style={{ flex: 1, overflowY: 'auto', padding: '20px', minHeight: 0 }}>
            {!response && !loading && (
              <div style={{ textAlign: 'center', marginTop: 80 }}>
                <div style={{ width: 56, height: 56, borderRadius: 18, background: 'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(6,182,212,0.2))', border: '1px solid rgba(124,58,237,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto 16px' }}>⚡</div>
                <p style={{ color: '#333', fontSize: 14, margin: 0, lineHeight: 1.6 }}>Ask Zappr anything<br /><span style={{ color: '#2a2a2a', fontSize: 12 }}>Fix bugs · Explain code · Create components</span></p>
              </div>
            )}
            {loading && !response && (
              <div style={{ textAlign: 'center', marginTop: 80 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #7c3aed, #06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, margin: '0 auto 12px', animation: 'pulse 1.5s ease-in-out infinite' }}>⚡</div>
                <p style={{ color: '#444', fontSize: 13, margin: 0 }}>Thinking...</p>
              </div>
            )}
            {response && (
              <div style={{ fontSize: 14, lineHeight: 1.75, color: '#e0e0e0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ width: 24, height: 24, borderRadius: 8, background: 'linear-gradient(135deg, #7c3aed, #06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>⚡</div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#a78bfa' }}>Zappr</span>
                  <span style={{ fontSize: 11, color: '#444' }}>· {provider}</span>
                </div>
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}
                  components={markdownComponents}
                >{response}</ReactMarkdown>
                <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 8 }}>
                  <button onClick={() => { void navigator.clipboard.writeText(response) }} style={{ padding: '6px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, fontSize: 11, color: '#666', cursor: 'pointer' }}>Copy</button>
                  <button onClick={() => { setResponse(''); setPrompt('') }} style={{ padding: '6px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, fontSize: 11, color: '#666', cursor: 'pointer' }}>New Chat</button>
                </div>
              </div>
            )}
          </div>

          {/* Quick prompts */}
          <div style={{ padding: '10px 16px', display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            {['Fix errors', 'Explain code', 'Add TypeScript types', 'Write unit tests', 'Refactor'].map(s => (
              <button key={s} onClick={() => setPrompt(s)} style={{ padding: '5px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 20, fontSize: 11, color: '#4a4a4a', cursor: 'pointer', transition: 'all 0.15s' }}>{s}</button>
            ))}
          </div>

          {/* Input */}
          <div style={{ padding: '12px 16px 16px' }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 0 0 1px rgba(124,58,237,0) , 0 8px 32px rgba(0,0,0,0.3)' }}>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void run() } }}
                placeholder="Ask Zappr anything about your code..."
                rows={3}
                style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', padding: '14px 16px', color: '#f0f0f0', fontSize: 14, resize: 'none', fontFamily: 'inherit', lineHeight: 1.6 }}
              />
              <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ fontSize: 10, color: '#2a2a2a' }}>↵ Send · ⇧↵ New line</span>
                <button onClick={() => void run()} disabled={loading} style={{ padding: '8px 20px', background: loading ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg, #7c3aed, #5b21b6)', border: 'none', borderRadius: 10, color: loading ? '#444' : '#fff', fontWeight: 700, fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '-0.01em', boxShadow: loading ? 'none' : '0 4px 12px rgba(124,58,237,0.4)' }}>
                  {loading ? '...' : '⚡ Zap'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
