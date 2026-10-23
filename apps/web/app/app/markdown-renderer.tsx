import React, { Fragment, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import hljs from 'highlight.js'

type HighlightToken = string | {
  scope?: string
  children: HighlightToken[]
}

type HighlightTokenEmitter = { root: { scope?: string; children: HighlightToken[] } }

function renderHighlightToken(token: HighlightToken, key: string): ReactNode {
  if (typeof token === 'string') return token

  const children = token.children.map((child, index) => renderHighlightToken(child, `${key}-${index}`))
  return token.scope
    ? <span key={key} className={`hljs-${token.scope}`}>{children}</span>
    : <Fragment key={key}>{children}</Fragment>
}

export function safeMarkdownUrl(value: string): string | null {
  try {
    const protocol = new URL(value, 'https://fixora.invalid').protocol
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' ? value : null
  } catch {
    return null
  }
}

const markdownComponents: Components = {
  pre: ({ children }) => (
    <pre style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '16px 20px', overflowX: 'auto', fontSize: 13, fontFamily: '"JetBrains Mono", monospace', margin: '12px 0', lineHeight: 1.7 }}>
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const isBlock = className?.startsWith('language-') === true
    if (isBlock) {
      const source = String(children)
      const language = className.slice('language-'.length)
      const highlighted = hljs.getLanguage(language)
        ? hljs.highlight(source, { language, ignoreIllegals: true })
        : hljs.highlightAuto(source)
      const root = (highlighted._emitter as typeof highlighted._emitter & HighlightTokenEmitter).root
      const tokens = root.children.map((token, index) => renderHighlightToken(token, String(index)))

      return <code className="hljs">{tokens}</code>
    }
    return <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: 5, fontSize: 12, fontFamily: '"JetBrains Mono", monospace', color: '#a78bfa' }}>{children}</code>
  },
  a: ({ href, title, children }) => {
    const safeHref = href ? safeMarkdownUrl(href) : null
    return safeHref
      ? <a href={safeHref} title={title}>{children}</a>
      : <span title={title}>{children}</span>
  },
}

export function MarkdownContent({ children }: { children: string }) {
  return (
    <ReactMarkdown
      skipHtml
      urlTransform={(url) => safeMarkdownUrl(url) ?? ''}
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={markdownComponents}
    >
      {children}
    </ReactMarkdown>
  )
}

export function SafeDiffLine({ value }: { value: string }) {
  return <>{value}</>
}
