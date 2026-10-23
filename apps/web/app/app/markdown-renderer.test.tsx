import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownContent, SafeDiffLine, safeMarkdownUrl } from './markdown-renderer'

function renderMarkdown(source: string) {
  return renderToStaticMarkup(createElement(MarkdownContent, null, source))
}

test('model HTML is ignored rather than emitted as executable elements or attributes', () => {
  const html = renderMarkdown([
    '<script>alert(1)</script>',
    '<img src="x" onerror="alert(1)">',
    '<svg onload="alert(1)"><text>bad</text></svg>',
    '<div>not a raw markdown element</div>',
    '```html\n<img src=x onerror=alert(1)>\n```',
  ].join('\n\n'))

  assert.doesNotMatch(html, /<script\b|<img\b|<svg\b|<div\b/i)
  assert.doesNotMatch(html, /onerror=|onload=/i)
})

test('unsafe markdown links are inert while HTTPS links remain clickable', () => {
  const html = renderMarkdown('[unsafe](javascript:alert%281%29)\n\n[safe](https://example.com/path)')

  assert.doesNotMatch(html, /href="javascript:/i)
  assert.match(html, /<span>unsafe<\/span>/)
  assert.match(html, /<a href="https:\/\/example\.com\/path">safe<\/a>/)
  assert.equal(safeMarkdownUrl('data:text/html,alert(1)'), null)
  assert.equal(safeMarkdownUrl('mailto:help@example.com'), 'mailto:help@example.com')
})

test('markdown formatting and syntax-highlighted fenced code remain rendered', () => {
  const html = renderMarkdown('# Heading\n\n**important**\n\n- first\n- second\n\n```js\nconst answer = 42\n```')

  assert.match(html, /<h1>Heading<\/h1>/)
  assert.match(html, /<strong>important<\/strong>/)
  assert.match(html, /<li>first<\/li>/)
  assert.match(html, /class="hljs-keyword"/)
  assert.match(html, /<span class="hljs-keyword">const<\/span> answer = <span class="hljs-number">42<\/span>/)
})

test('HTML-like diff content is rendered as escaped text', () => {
  const html = renderToStaticMarkup(createElement('div', null,
    createElement(SafeDiffLine, { value: '+<img src=x onerror=alert(1)>' }),
  ))

  assert.doesNotMatch(html, /<img\b/i)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
})
