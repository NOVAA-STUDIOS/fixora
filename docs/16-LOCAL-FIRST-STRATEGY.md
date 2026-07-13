# Fixora — Local-First Data Strategy

> **The default answer to "where does my code go?" is: nowhere.**

This is simultaneously our privacy posture, our cost structure, our performance story, and our enterprise
wedge. It is one decision paying four dividends, which is why it is worth defending against every
convenient exception someone will propose.

---

## 1. The line

| Lives on the user's machine, always | Lives in our cloud |
|---|---|
| Source code | Account (email, id) |
| Findings | Subscription + entitlements |
| Patches, diffs, rationales | Usage **counts** (tokens, latency, model, task profile) |
| Verification reports | Anonymous telemetry events |
| Chat / session history | Release manifest |
| Workspace settings | Audit log of *account* actions |
| BYOK keys, refresh tokens (OS keychain) | — |

**Crossing the line, ever:** a **transient prompt payload** — a code slice plus its evidence — held in RAM
on our gateway, forwarded to a provider under a zero-retention agreement, never written to disk or DB.
In **BYOK mode it doesn't even do that**: the desktop app talks to the provider directly and our servers see
nothing but a metering ping.

---

## 2. Why this, and not the normal SaaS shape

The normal shape — sync everything to the cloud — buys cross-device history and server-side analytics. It
costs:

- **The sale.** Persona 1 (senior engineer at a company with an IP policy) cannot install a tool that uploads
  her employer's source. This is not a preference. It is a policy she will be fired for violating. Every
  feature we build for her is worthless if we lose her at this gate.
- **The trust conversation.** "We don't train on your data, we promise" is a conversation you can only win
  with a brand. We don't have one. **The strongest possible position for a new company is a claim that
  doesn't require trust: *we can't leak it, we never had it.***
- **The breach exposure.** A database holding a thousand companies' source code is an extraordinary target
  and an existential liability. We would be one misconfigured bucket from the end.
- **SOC 2 as a *precondition* for the first enterprise sale**, rather than a milestone we reach later.
- **Money.** Storage and egress on code we don't need.

And what we *lose* — cross-device history — is a feature nobody churns over. Developers work on one machine.

**This is the rare architectural decision where the ethical choice, the security choice, the cost choice
and the go-to-market choice are the same choice.** When that happens you take it and you don't get clever.

---

## 3. Trade-offs, stated honestly

| We give up | Mitigation |
|---|---|
| Cross-device / cross-machine history | Explicit **export/import** of history (their data, their disk). Opt-in E2EE sync is the Teams-milestone answer, and it stays E2EE. |
| Server-side analytics on real code | We get event-level telemetry (apply-rate, verification pass-rate). **We don't need code to measure quality — the golden corpus does that**, and it's a better signal than production peeping anyway. |
| Server-side history search | Local SQLite **FTS5**. Fast, and it works on a plane. |
| A local migration + backup system to build | Real cost. ~3 days. Worth it. |
| We can't reproduce a user's bug from our own logs | **Redacted diagnostics bundle**, generated locally, sent only if the user chooses to attach it. This is more work than reading their code off our server, and it is the correct amount of work. |

---

## 4. Offline behaviour

**The app is fully functional offline and signed-out for local analysis.** Open a workspace, run the
analyzers, browse findings, read history. Only cloud AI requires a session.

This is a deliberate product decision, not a fallback. It means:

- The free tier can offer **unlimited local analysis at zero marginal cost to us** — the most generous free
  tier we can afford, and it *is* the marketing.
- A network blip degrades one panel, not the app.
- The tool works on a plane, behind a corporate proxy, and on an air-gapped machine — three places where
  Cursor doesn't.

Cached entitlements and feature flags mean a brief outage on our side doesn't disable paid features. A long
one does, and it should.

---

## 5. Sync — the door we deliberately leave shut

We are **not** building sync in v1. But the schema does not preclude it:

- Local tables carry `id` (UUID, client-generated) and `updated_at`, so a future sync has something to work
  with.
- No local id is derived from a server id. Nothing about the local schema assumes a server exists.

**When sync arrives (Teams), it must be end-to-end encrypted with client-held keys**, or it is not sync — it
is the cloud-storage decision we just spent this document rejecting, arriving through the back door wearing a
different hat. Anyone proposing "just a little server-side history so we can debug" is proposing exactly that.

---

## 6. The user's control surface

Non-negotiable, and it ships in v1:

- **A settings page that states, plainly and per-mode, what leaves the machine.** Not a link to a privacy
  policy. The actual sentence, in the app, where the decision is made.
- **BYOK toggle** — key in the OS keychain, requests direct to the provider.
- **Telemetry toggle**, off by default, with a "show me exactly what you'd send" button that prints the
  actual JSON. Nobody will click it. It changes how the feature gets built anyway, because you cannot ship
  that button and also quietly log a file path.
- **Export history** to JSON.
- **Delete all local data**, in one action, that actually deletes it.
- **Per-workspace trust** for test execution. Trusting one repo must never trust all of them — a cloned
repo from a stranger is untrusted code, and the moment we blanket-trust workspaces we've built a remote
code execution vector with a friendly UI.
</content>

</invoke>
