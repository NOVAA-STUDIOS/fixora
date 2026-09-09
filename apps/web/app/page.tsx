'use client'
import Link from 'next/link'

export default function Home() {
  return (
    <main style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #0a0a0f 0%, #080808 60%, #0a080f 100%)', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif', overflowX: 'hidden' }}>

      {/* Nav */}
      <nav style={{ padding: '16px 32px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid rgba(255,255,255,0.04)', position: 'sticky', top: 0, background: 'rgba(8,8,8,0.85)', backdropFilter: 'blur(20px)', zIndex: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: 'linear-gradient(135deg, #7c3aed, #06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, boxShadow: '0 4px 12px rgba(124,58,237,0.4)' }}>⚡</div>
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em' }}>Fixora</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          <a href="https://fixora-opal.vercel.app" style={{ fontSize: 13, color: '#555', textDecoration: 'none', padding: '7px 16px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)' }}>Download</a>
          <Link href="/app" style={{ fontSize: 13, color: '#fff', textDecoration: 'none', padding: '7px 18px', borderRadius: 20, background: 'linear-gradient(135deg, #7c3aed, #5b21b6)', border: '1px solid rgba(124,58,237,0.4)', fontWeight: 600 }}>Try Free →</Link>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '100px 24px 80px', maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 20, fontSize: 12, color: '#a78bfa', marginBottom: 28, fontWeight: 500 }}>
          ⚡ Powered by Zappr AI · Free to use
        </div>

        <h1 style={{ fontSize: 'clamp(36px, 6vw, 64px)', fontWeight: 800, margin: '0 0 20px', letterSpacing: '-0.04em', lineHeight: 1.1 }}>
          <span style={{ background: 'linear-gradient(135deg, #f0f0f0 0%, #888 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Fix your code</span>
          <br />
          <span style={{ background: 'linear-gradient(135deg, #7c3aed, #06b6d4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>in seconds</span>
        </h1>

        <p style={{ fontSize: 'clamp(15px, 2vw, 19px)', color: '#666', margin: '0 0 40px', lineHeight: 1.7, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>
          AI-powered code assistant. Paste your broken code, describe the issue, and get it fixed instantly — no download required.
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/app" style={{ padding: '14px 32px', background: 'linear-gradient(135deg, #7c3aed, #5b21b6)', borderRadius: 14, color: '#fff', fontWeight: 700, fontSize: 15, textDecoration: 'none', boxShadow: '0 8px 32px rgba(124,58,237,0.4)', letterSpacing: '-0.01em' }}>
            ⚡ Try Zappr Free
          </Link>
          <a href="https://fixora-opal.vercel.app" style={{ padding: '14px 32px', background: 'rgba(255,255,255,0.04)', borderRadius: 14, color: '#e0e0e0', fontWeight: 600, fontSize: 15, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.08)' }}>
            Download Desktop App ↓
          </a>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 40, justifyContent: 'center', marginTop: 60, flexWrap: 'wrap' }}>
          {[
            { value: '10K+', label: 'Bugs Fixed' },
            { value: '5+', label: 'AI Providers' },
            { value: '100%', label: 'Free to Try' },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', background: 'linear-gradient(135deg, #f0f0f0, #888)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{s.value}</div>
              <div style={{ fontSize: 12, color: '#444', marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section style={{ padding: '60px 24px', maxWidth: 960, margin: '0 auto' }}>
        <h2 style={{ textAlign: 'center', fontSize: 'clamp(24px, 4vw, 36px)', fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 48px', background: 'linear-gradient(135deg, #f0f0f0, #666)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Everything you need
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          {[
            { icon: '🔧', title: 'Fix Bugs Instantly', desc: 'Paste broken code and get a working fix in seconds. Supports Python, TypeScript, Go, Rust, and more.' },
            { icon: '📖', title: 'Explain Any Code', desc: 'Understand complex codebases instantly. Get clear, concise explanations for any code snippet.' },
            { icon: '✨', title: 'Generate Components', desc: 'Create React components, utility functions, API clients, and more from a simple description.' },
            { icon: '🧪', title: 'Write Tests', desc: 'Auto-generate unit tests for your functions. Never miss edge cases again.' },
            { icon: '🔑', title: 'Bring Your Own Key', desc: 'Works with Gemini, OpenAI, OpenRouter, Anthropic, and local Ollama — your choice.' },
            { icon: '⚡', title: 'Streaming Responses', desc: 'See responses as they generate — no waiting for the full answer before reading.' },
          ].map(f => (
            <div key={f.title} style={{ padding: '24px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 18, transition: 'border-color 0.2s' }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>{f.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8, color: '#e0e0e0', letterSpacing: '-0.01em' }}>{f.title}</div>
              <div style={{ fontSize: 13, color: '#555', lineHeight: 1.7 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{ textAlign: 'center', padding: '80px 24px 100px' }}>
        <div style={{ maxWidth: 520, margin: '0 auto', padding: '48px 40px', background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)', borderRadius: 28 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚡</div>
          <h2 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 12px', letterSpacing: '-0.03em' }}>Ready to fix your code?</h2>
          <p style={{ fontSize: 14, color: '#555', margin: '0 0 28px', lineHeight: 1.6 }}>Free to use. No account required. Bring your own API key.</p>
          <Link href="/app" style={{ display: 'inline-block', padding: '14px 36px', background: 'linear-gradient(135deg, #7c3aed, #5b21b6)', borderRadius: 14, color: '#fff', fontWeight: 700, fontSize: 15, textDecoration: 'none', boxShadow: '0 8px 32px rgba(124,58,237,0.35)' }}>
            Start for Free →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ textAlign: 'center', padding: '24px', borderTop: '1px solid rgba(255,255,255,0.04)', fontSize: 12, color: '#333' }}>
        <span>© 2026 NOVAA Studios · </span>
        <a href="/privacy" style={{ color: '#444', textDecoration: 'none' }}>Privacy</a>
        <span> · </span>
        <a href="/terms" style={{ color: '#444', textDecoration: 'none' }}>Terms</a>
        <span> · </span>
        <a href="https://fixora-opal.vercel.app" style={{ color: '#444', textDecoration: 'none' }}>Desktop App</a>
      </footer>
    </main>
  )
}
