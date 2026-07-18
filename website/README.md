# Fixora website (Beta)

A static, dependency-free download + trust page. No build step — plain HTML/CSS, self-contained. Deploy
the `website/` folder to any static host (Cloudflare Pages, GitHub Pages, Netlify).

## Before publishing — replace 3 placeholders

Search-and-replace across `index.html`:

| Placeholder    | Replace with                                                                               |
| -------------- | ------------------------------------------------------------------------------------------ |
| `DOWNLOAD_URL` | The Windows installer link (e.g. a GitHub Release asset for `Fixora-Setup-<version>.exe`). |
| `STRIPE_URL`   | Your Stripe **Payment Link** for the Supporter/Pro license (see `docs/LICENSING.md`).      |
| `FORM_ACTION`  | Your email-capture endpoint (Buttondown, Formspree, ConvertKit, …).                        |

Also set real addresses in `privacy.html` and `.well-known/security.txt`.

## Deploy (Cloudflare Pages, example)

1. Push this repo (or a copy of `website/`) to a Git host.
2. Cloudflare Pages → Create project → connect the repo → **build command: none**, **output dir:
   `website`** (or the repo root if you publish `website/` alone).
3. Point your domain (`fixora.dev`) at the Pages project.

GitHub Pages: put these files at the root of a `gh-pages` branch (or a `/docs` folder) and enable Pages.

## Contents

- `index.html` — hero + how-it-works + privacy claims + pricing (Free/Supporter) + email capture.
- `privacy.html` — the testable privacy claims, in plain English.
- `.well-known/security.txt` — RFC 9116 security contact.

The copy is written to match what the app actually does (verified repair, BYOK, secret gate, local-first,
telemetry off by default). Keep it honest — the trust story is the product.
