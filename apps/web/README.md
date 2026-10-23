# Fixora Web

The standalone Next.js Zappr chat companion. It is a smaller web chat, not the Electron IDE: it does
not share desktop SQLite history, desktop provider discovery/failover, filesystem access, or the
desktop Zappr plan-approval/rollback pipeline.

## Current features

- Routes: `/` landing page, `/app` chat, and `POST /api/zappr` provider proxy.
- BYOK providers in the web UI: Gemini, OpenAI, OpenRouter, and Anthropic. The Node API route owns a
  fixed endpoint/model allowlist; callers cannot select arbitrary URLs. Local desktop providers,
  Azure, and Groq are not exposed by this web route.
- The API key is React in-memory state only and clears on refresh. Provider preference is persisted in
  browser localStorage; the raw key is not. Each chat request explicitly sends the current key to
  `/api/zappr`, which forwards it to the selected provider. Do not put credentials in prompts,
  share-links, exports, or issue reports.
- Chat state is page-local. Sharing encodes redacted messages/provider metadata in a URL; markdown
  export redacts the current key. The UI also supports text/file attachment, drag-and-drop, speech
  input where the browser supports Web Speech, themes, Markdown/GFM/math, code highlighting, and code
  diff presentation.
- Markdown rendering disables raw HTML (`react-markdown` `skipHtml`), renders syntax highlighting as
  React token elements, and allows only HTTP(S)/mailto link protocols. HTML-like model text is not
  inserted into the DOM as trusted HTML.

## API proxy limits

`app/api/zappr/proxy-handler.ts` validates provider, message shape and bounded request sizes, rejects
foreign origins where request metadata permits, uses fixed upstream URLs, applies an upstream timeout,
normalizes failures, disables response caching, and streams provider output. A process-memory limit
allows 20 requests per 10 minutes per client key, but is best effort per running instance: it is not a
distributed/global quota and may reset or diverge across serverless instances. IP identification also
depends on deployment proxy headers being set by a trusted edge. The route has no account
authentication; deployment operators should account for proxy-abuse exposure.

## Development

From the monorepo root, with the pinned pnpm version installed:

```bash
pnpm --filter @fixora/web dev
pnpm --filter @fixora/web lint
pnpm --filter @fixora/web build
pnpm --filter @fixora/web start
```

The web package is independently versioned (`0.1.0` in the inspected manifest) and is excluded from
the root desktop-focused `build`, `typecheck`, and `lint` scripts. Run its checks explicitly.

## Deployment

This is a Next.js Node-runtime app; deploy it to a Node-compatible Next.js host. `/api/zappr` requires
streaming request/response support. Configure the host's trusted proxy to overwrite the client-IP
headers used by the best-effort limiter. The repository has no durable chat store, account system,
global rate-limit store, or server-side API-key storage. Do not interpret a successful local build as
production abuse protection or as a desktop release.
