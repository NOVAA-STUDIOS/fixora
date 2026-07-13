# Fixora — Deployment Strategy

Three artifacts, three pipelines, three failure modes. The desktop app is the one you cannot take back.

---

## 1. What ships where

| Artifact | Target | Reversible? |
|---|---|---|
| **Desktop app** | Signed installers → CDN, manifest → our API | ⚠️ **Only via a staged-rollout halt.** Once a client has updated, it has updated. |
| **API** | Containers, blue-green | ✅ Roll back in seconds |
| **Website** | Vercel | ✅ Instant |

**This asymmetry drives everything.** The API and the site can be fixed in a minute. A bad desktop release is
in the wild, on machines we do not control, with users who may not reopen the app for a week. **The kill
switches (ADR-027) and the staged rollout (ADR-022) are not conveniences — they are the only reversibility we
have.**

---

## 2. Environments

|  | Local | Staging | Production |
|---|---|---|---|
| API | Docker Compose | Fly/Railway | Fly/Railway, blue-green |
| DB | Local Postgres | **Neon branch** | Neon primary + PITR |
| Auth | Supabase dev project | Supabase staging | Supabase prod |
| Providers | `MockProvider` (deterministic, free) | Real, low limits | Real |
| Stripe | Test mode | Test mode | Live |
| Desktop | `pnpm dev` | `beta` channel | `stable` channel |

**Neon branch-per-PR** is the single best thing about choosing Neon (ADR-009): every pull request gets a real,
isolated database seeded from a production-shaped snapshot. Migration bugs are caught in review, on a real
database, before they can touch a real one. This is worth more to us than the RLS we gave up.

**`MockProvider` in local dev** is not a nice-to-have. Without it, every developer running the app burns real
tokens on every keystroke of debugging, which makes people avoid running the app — and the fastest way to
ship a bad product is to make the team reluctant to use it.

**No manual production deploys. Ever.** Not for a hotfix, not at 3am, not "just this once". Every path to
production goes through CI, because the one time it doesn't is the time nobody can reconstruct what shipped.

---

## 3. Pipelines

### API

```
PR → typecheck · lint · unit · integration (testcontainers) · pip-audit · Alembic dry-run on a Neon branch
merge → build image → deploy staging → smoke tests → deploy prod (blue-green) → health checks → cut over
```

**Migrations run separately from and before the deploy**, and must be **backward-compatible with the running
version** — because during blue-green, old and new code are talking to the same database at the same time.
This means: expand → migrate → contract, as three deploys, never one. Additive migrations only in step one;
the destructive part happens after the old code is gone.

Skipping this is how a "zero-downtime" deploy takes the whole API down for four minutes at the exact moment
you were showing it to someone.

### Desktop

```
tag v1.2.0
  → build (clean CI runner, never a laptop)
  → Azure Trusted Signing
  → SBOM + provenance attestation
  → upload artifacts + blockmaps to CDN
  → INSERT releases (rollout_percent = 0)
  → manual promote: 5% → watch → 25% → watch → 100%
```

The watch between steps is **crash-free sessions** and the **fix apply-rate**. A release that raises crashes
*or* quietly degrades fix quality gets halted. The second one is the one nobody thinks to check, and it is
exactly what a bad prompt change looks like in production.

### Website

Push to main → Vercel. It's a website.

---

## 4. Observability & the numbers we watch

| Signal | Threshold | Action |
|---|---|---|
| Crash-free sessions | < 99.5% | **Halt the rollout** |
| API p99 time-to-first-token | > 3 s | Investigate provider; consider failover |
| Fix apply-rate (7-day) | drops > 10% relative | **Suspect a prompt/model regression.** Check the corpus. |
| Gross margin per user | < 50% | Model routing / quota review |
| Provider error rate | > 2% | Failover to secondary |
| Fixes reverted < 10 min | > 5% | **"Verified" is lying.** This is a P1 — it is our core claim. |

That last row deserves emphasis. Our entire thesis is *"we prove the fix works."* A rising revert-rate means
the proof is false, and a false proof is worse than no proof — it is the one bug that would justify a user
never trusting us again. It gets paged, not dashboarded.

**Average latency is a lie.** We alert on p99 time-to-first-token, because the average hides exactly the tail
that makes a product feel broken to the person experiencing it.

---

## 5. Cost model

| Cost | Driver | Control |
|---|---|---|
| **Model tokens** | The whole business | Routing, caching, symbol-slicing, quota, BYOK |
| API compute | Requests | Stateless → scales to zero between them |
| Neon | Rows | Tiny. **We store no code** — this is what makes the infra bill boring. |
| CDN | Installer downloads | Blockmap deltas keep it small |
| Sentry / o11y | Events | Sampling |

Everything except tokens is rounding error. **This is a direct consequence of the local-first decision
(ADR-004): we don't run analysis, we don't store code, we don't stream files.** The infrastructure bill of a
product that keeps the work on the user's machine is *supposed* to be boring, and ours is.

Which means there is exactly one number to defend: **gross margin per user**, watched from day one because
`usage_events` exists from M4 (ADR-023).

---

## 6. Disaster scenarios (decide now, not at 3am)

| Scenario | Response |
|---|---|
| Bad desktop release | Halt rollout. Ship a fix on `beta`. Promote when green. |
| A task profile is producing garbage | **Server-side kill switch.** No desktop update required. |
| Provider outage | Automatic failover to secondary. Users see which model answered. |
| Our API is down | Clients degrade to **local analysis only** — the app still works. Cached entitlements cover a short outage. |
| Neon is down | AI requests fail (no quota check). **We do not fail open** — failing open on quota is free tokens for everyone with a script. |
| Signing certificate compromised | Revoke, re-sign, force-update, disclose. Rehearsed. |
| **A secret was leaked to a provider** | Kill switch → notify affected users → rotate → disclose → post-mortem. **This is the drill we rehearse before launch**, because it is the one that ends the company if we improvise it. |

</content>
</invoke>
