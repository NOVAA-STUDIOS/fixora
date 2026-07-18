# Fixora Licensing (Beta) — owner setup

Fixora's beta is **free with your own key** (BYOK). A one-time **Supporter/Pro** license funds
development. It is an **Ed25519-signed token the app verifies offline** — there is no license server,
nothing calls home, and the beta gates no core feature on it (it grants Pro/supporter status and is the
entitlement plumbing v1.1's managed tier builds on). This is what you set up before selling.

## Model

- **Free** — everything: analysis, BYOK AI, verified repair, diff, apply, history.
- **Pro / Supporter** — a signed license (`plan: "pro"`). Same features in the beta; recognition +
  locked-in early-supporter benefits for v1.1. Revenue at launch, zero backend.

Evolves without a rewrite: the app reads a `LicenseStatus` entitlement; v1.1 swaps the *issuer* (a Stripe
webhook → the gateway issues/refreshes it) for the same *reader* (ADR-036/038).

## One-time setup

### 1. Generate the signing keypair (keep the private key OFFLINE)

```
node tooling/scripts/license-keygen.mjs
```

- Paste the **PUBLIC** key into `apps/desktop/electron/main/license/public-key.ts`
  (`EMBEDDED_PUBLIC_KEY_DER_B64`), or set `FIXORA_LICENSE_PUBLIC_KEY` for staging.
- Save the **PRIVATE** key in your password manager. **Never commit it. Never put it in the app.** If it
  leaks, anyone can mint licenses; if you lose it, you must re-issue every license. There is no recovery.

Until a public key is embedded, every install is Free and `Activate` honestly reports "licensing isn't
enabled in this build yet" — the app never pretends.

### 2. Create the Stripe Payment Link

- In the Stripe dashboard: **Payment Links → new link** for the Supporter/Pro product (one-time price).
- Set the success page to your site's "thank you — check your email for your key" page.
- Put the link on the website (`fixora.dev/pro`) and in the app's Settings → License copy
  (`PURCHASE_URL`).

### 3. Fulfilment (mint + send the key)

On each purchase (manually from the Stripe dashboard, or later via a Zapier/Make step on the
`checkout.session.completed` event):

```
FIXORA_LICENSE_PRIVATE_KEY_FILE=./fixora-license-private.pem \
  node tooling/scripts/sign-license.mjs buyer@example.com
```

This prints one license key. Email it to the buyer. They paste it into **Settings → License → Activate**;
the app verifies it offline and shows **Fixora Pro**. (Add a trailing `days` argument for a time-limited
license; omit it for a perpetual supporter license.)

## Security notes

- The license token is **signed, not secret** — it proves an entitlement, it is not a credential. It is
  stored in plain `license.json` in the app's userData. Sharing it is low-stakes for a supporter tier.
- Tampering (changing the plan or expiry) breaks the signature → the app rejects it. Verified by test
  (`license.test.ts`): tamper, wrong-key, expiry, and malformed are all rejected; only a genuinely signed,
  unexpired token becomes Pro.
- Rotating the keypair invalidates every issued license — do it only if the private key is compromised.
