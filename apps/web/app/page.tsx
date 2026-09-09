'use client'
import Link from 'next/link'

export default function Home() {
  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
      <div style={{ width: 72, height: 72, borderRadius: 20, background: 'linear-gradient(135deg, #7c3aed, #06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, marginBottom: 24 }}>⚡</div>
      <h1 style={{ fontSize: 48, fontWeight: 700, margin: '0 0 16px', letterSpacing: '-0.03em', background: 'linear-gradient(135deg, #f0f0f0, #888)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Fixora</h1>
      <p style={{ fontSize: 20, color: '#888', margin: '0 0 8px', maxWidth: 480 }}>AI-powered code assistant. Fix bugs, explain code, and build features — instantly.</p>
      <p style={{ fontSize: 14, color: '#444', margin: '0 0 40px' }}>No download required. Bring your own API key.</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link href="/app" style={{ padding: '12px 28px', background: 'linear-gradient(135deg, #7c3aed, #5b21b6)', borderRadius: 10, color: '#fff', fontWeight: 600, fontSize: 15, textDecoration: 'none', border: '1px solid rgba(124,58,237,0.5)' }}>⚡ Try Zappr Free</Link>
        <a href="https://fixora-opal.vercel.app" style={{ padding: '12px 28px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, color: '#f0f0f0', fontWeight: 600, fontSize: 15, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.08)' }}>Download Desktop App</a>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginTop: 64, maxWidth: 700, width: '100%' }}>
        {[
          { icon: '🔧', title: 'Fix Bugs', desc: 'Paste broken code, get it fixed instantly' },
          { icon: '📖', title: 'Explain Code', desc: 'Understand any codebase in seconds' },
          { icon: '✨', title: 'Create Files', desc: 'Generate components, utils, and more' },
          { icon: '🔑', title: 'Your API Key', desc: 'Works with Gemini, OpenAI, and more' },
        ].map(f => (
          <div key={f.title} style={{ padding: '20px', background: '#0f0f0f', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)', textAlign: 'left' }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>{f.icon}</div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{f.title}</div>
            <div style={{ fontSize: 13, color: '#666' }}>{f.desc}</div>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 48, fontSize: 12, color: '#333' }}>By NOVAA Studios · <a href="/privacy" style={{ color: '#555' }}>Privacy</a> · <a href="/terms" style={{ color: '#555' }}>Terms</a></p>
    </main>
  )
}
