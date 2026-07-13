# Fixora — System Architecture & Diagrams

All diagrams are Mermaid and render in GitHub and VS Code.

---

## 1. Context (C4 Level 1)

```mermaid
graph TB
    dev([Developer])
    subgraph machine["Developer's machine — the trust boundary"]
        app[Fixora Desktop<br/>Electron]
        code[(Local source code<br/>+ SQLite history)]
        tools[Workspace tooling<br/>eslint · tsc · ruff · pytest · go]
    end
    api[Fixora API<br/>FastAPI · stateless]
    idp[Supabase Auth<br/>IdP only]
    db[(Neon Postgres<br/>accounts · quota · usage<br/>NO CODE)]
    llm[Model providers<br/>Anthropic · OpenAI]
    stripe[Stripe]
    cdn[Release CDN]

    dev --> app
    app <--> code
    app --> tools
    app -->|SSE · JWT · code in transit only| api
    app -.->|BYOK mode: our servers bypassed| llm
    app -->|PKCE · system browser| idp
    app -->|update manifest| api
    app --> cdn
    api --> llm
    api --> db
    api --> stripe
    api -->|JWKS verify| idp

    style machine fill:#1a1625,stroke:#8b5cf6,color:#fff
    style db fill:#0f172a,stroke:#334155,color:#fff
```

**The line that matters:** everything inside `machine` is the user's. Source code crosses the boundary
only as a transient prompt payload, only after passing the secret gate, and in BYOK mode not through us
at all.

---

## 2. Container / component view (C4 Level 2)

```mermaid
graph TB
    subgraph electron["Fixora Desktop (Electron)"]
        subgraph renderer["Renderer — sandboxed, no Node, treat as hostile"]
            ui[React · Tailwind · Radix]
            monaco[Monaco + Diff Editor]
            zst[Zustand — UI state]
            tsq[TanStack Query — wire state]
            cmd[Command Registry ⌘K]
        end
        preload[["Preload — contextBridge<br/>the ONLY surface"]]
        subgraph main["Main — Node, privileged"]
            router[IPC Router<br/>zod-validated both ways]
            wssvc[Workspace Service]
            fssvc[FS Service — path-guarded]
            patchsvc[Patch Service<br/>apply · checkpoint · undo]
            aiclient[AI Client]
            authsvc[Auth Service — PKCE + keychain]
            sqlite[(SQLite · WAL)]
            updater[Auto-Updater]
        end
        subgraph workers["Utility processes — isolated, killable"]
            anworker[Analysis Worker<br/>tree-sitter WASM · linters · Semgrep]
            vworker[Verify Worker<br/>overlay FS · re-check · tests]
        end
    end

    subgraph pkgs["packages/core-* — pure TS, zero Electron, zero React"]
        canalysis[core-analysis]
        cai[core-ai]
        cpatch[core-patch]
    end

    subgraph server["Fixora API"]
        authmw[JWT verify · JWKS]
        ent[Entitlements + Quota]
        gw[AI Gateway — stateless]
        prov[Provider Abstraction]
        meter[Usage Metering]
        rel[Release Feed]
    end

    ui --> preload --> router
    monaco --- ui
    router --> wssvc & fssvc & patchsvc & aiclient & authsvc & updater
    wssvc --> sqlite
    router --> anworker & vworker
    anworker -.uses.-> canalysis
    vworker -.uses.-> canalysis & cpatch
    aiclient -.uses.-> cai
    patchsvc -.uses.-> cpatch
    aiclient -->|SSE| authmw --> ent --> gw --> prov
    gw --> meter
    updater --> rel

    style renderer fill:#1e1b31,stroke:#8b5cf6,color:#fff
    style pkgs fill:#0f1f1a,stroke:#10b981,color:#fff
    style workers fill:#2a1f14,stroke:#f59e0b,color:#fff
```

**Why `packages/core-*` is drawn separately:** it is the intellectual property. It has no dependency on
Electron or React, which means (a) it is unit-testable without a display, (b) `fixora-cli` and a GitHub
Action cost weeks not quarters, and (c) an eventual Tauri migration would be a *shell* rewrite, not a
*product* rewrite. A lint rule forbids importing `electron` or `react` from these packages, and CI
enforces it.

---

## 3. Sequence — the repair loop (the product)

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant R as Renderer
    participant M as Main
    participant A as Analysis Worker
    participant AI as AI Gateway/Provider
    participant V as Verify Worker
    participant FS as Disk

    U->>R: Open workspace
    R->>M: workspace:open
    M->>A: analyze(workspace)
    A->>A: tree-sitter parse · eslint · tsc · semgrep
    A-->>M: Finding[] (streamed)
    M-->>R: findings (incremental — UI fills as they arrive)

    U->>R: "Repair this finding"
    R->>M: ai:repair(findingId)
    M->>M: ContextBuilder — symbol graph + evidence + conventions
    M->>M: TokenBudgeter — hard cap, drop lowest-ranked context
    M->>M: 🔒 SECRET GATE — gitleaks + denylist
    Note over M: If a secret is detected, the request is BLOCKED<br/>and the user is told why. Never silently sent.
    M->>AI: stream(task=repair, schema=UnifiedDiff)
    AI-->>M: tokens (SSE)
    M-->>R: partial rationale (streams to UI immediately)
    AI-->>M: PATCH (unified diff) + rationale + confidence

    M->>V: verify(patch)
    V->>V: CoW overlay (hardlinks) — original disk untouched
    V->>V: re-run analyzers + type-check
    V->>V: run AFFECTED tests (opt-in, sandboxed, timeboxed)
    V-->>M: VerificationReport
    Note over V,M: Fixes target finding? Introduced a NEW one?<br/>New finding ⇒ labelled REGRESSION, not a fix.

    M-->>R: diff + rationale + VerificationReport
    R-->>U: Diff editor + trust surface

    U->>R: Apply (hunks 1 and 3 only)
    R->>M: patch:apply(hunks)
    M->>M: content-hash check — did the file change on disk?
    alt File changed since patch was generated
        M-->>R: PATCH_CONFLICT — re-propose. NEVER force-apply.
    else Clean
        M->>FS: checkpoint → apply → fsync
        M->>M: record in SQLite (patches, applications, checkpoints)
        M-->>R: applied · undo available (one keystroke)
    end
```

Read step 3–4 and step 12 together: **the model never sees code that hasn't passed the secret gate, and
the user never sees a fix that hasn't passed verification.** Those two gates are the product.

---

## 4. Sequence — authentication (PKCE, system browser)

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant R as Renderer
    participant M as Main
    participant B as System Browser
    participant S as Supabase (IdP)
    participant API as Fixora API
    participant N as Neon

    R->>M: auth:signIn
    M->>M: generate code_verifier, S256 challenge, CSPRNG state
    M->>B: shell.openExternal(authorize_url, redirect=fixora://auth/callback)
    B->>S: user authenticates (password manager · SSO · MFA all work)
    S-->>B: 302 → fixora://auth/callback?code&state
    B->>M: OS deep link (single-instance lock forwards it)
    Note over M: Loopback listener on 127.0.0.1:&lt;random&gt; is the<br/>fallback for managed Windows images where<br/>protocol registration fails. Both are shipped.
    M->>M: validate state (reject on mismatch)
    M->>S: exchange(code + code_verifier)
    S-->>M: access_token + refresh_token
    M->>M: refresh_token → OS keychain (safeStorage/DPAPI)<br/>access_token → memory only
    M->>API: GET /v1/me (Bearer)
    API->>S: fetch JWKS (cached, rotation-aware)
    API->>API: verify iss · aud · exp · signature
    API->>N: JIT-provision users row on first sight of this sub
    API-->>M: { user, plan, entitlements, featureFlags }
    M-->>R: { user, plan, entitlements }
    Note over R: The renderer NEVER receives a token.<br/>Not in memory, not in localStorage, ever.
```

---

## 5. Data flow — what crosses which boundary

```mermaid
flowchart LR
    subgraph L["🖥️ Local — the user's machine"]
        SRC[Source code]
        FIND[Findings]
        PATCH[Patches + diffs]
        HIST[(SQLite: sessions,<br/>findings, patches, chats)]
        KEY[OS Keychain:<br/>refresh token · BYOK key]
    end

    subgraph T["🔐 Secret gate"]
        GATE{gitleaks +<br/>denylist}
    end

    subgraph W["☁️ Wire — transient only"]
        PROMPT[Prompt payload:<br/>code slice + evidence]
    end

    subgraph C["☁️ Cloud — Neon"]
        ACC[Accounts]
        ENT[Entitlements]
        USE[usage_events:<br/>token counts, latency,<br/>model, task profile]
        TEL[Anonymous telemetry:<br/>repair.applied etc.]
    end

    SRC --> FIND --> PATCH --> HIST
    SRC --> GATE
    GATE -->|pass| PROMPT
    GATE -->|FAIL: blocked, user told why| SRC
    PROMPT -->|RAM only · never persisted| LLM[Model provider]
    LLM -->|patch| PATCH
    USE -.->|counts only, never content| C
    FIND -.->|❌ never leaves| C
    PATCH -.->|❌ never leaves| C
    HIST -.->|❌ never leaves| C
    KEY -.->|❌ never leaves| C

    style L fill:#0f1f1a,stroke:#10b981,color:#fff
    style T fill:#2a1414,stroke:#ef4444,color:#fff
    style C fill:#0f172a,stroke:#334155,color:#fff
```

**The invariant, stated once so it can be tested:** the only user content that ever crosses the machine
boundary is a *transient prompt payload*, and only after the secret gate passes. Findings, patches,
history and keys never cross it at all. `usage_events` carries **counts, not content**.

An automated test asserts that a log line or a DB write containing source code is rejected. This is not a
policy; it is a unit test.

---

## 6. Deployment view

```mermaid
graph TB
    subgraph gh["GitHub Actions"]
        ci[CI: typecheck · lint · unit · e2e ·<br/>Electronegativity · gitleaks · axe · golden corpus]
        build[Build + Azure Trusted Signing]
        apibuild[API image build]
    end
    subgraph prod["Production"]
        cdn[Object storage + CDN<br/>signed installers, blockmaps]
        apiprod[Fixora API<br/>containers · blue-green]
        neon[(Neon Postgres<br/>+ branch-per-PR)]
    end
    subgraph web["Vercel"]
        site[fixora-web · Next.js]
    end
    obs[Sentry · OpenTelemetry]

    ci --> build --> cdn
    build -->|releases row @ rollout_percent = 0| neon
    ci --> apibuild --> apiprod
    apiprod --> neon
    apiprod --> obs
    site -->|download endpoint proxy| apiprod

    client[Installed clients] -->|update manifest| apiprod
    client --> cdn
    client --> obs

    style prod fill:#0f172a,stroke:#8b5cf6,color:#fff
```

**Staged rollout:** a release is written at `rollout_percent = 0`, promoted 5% → 25% → 100%, watching
crash-free-sessions between steps. Desktop clients in the wild **cannot be hot-fixed** — the manifest is
the only kill switch we have, so it must be ours (ADR-022).

---

## 7. The four architectural invariants

These are load-bearing. A change that violates one is wrong, however convenient.

| # | Invariant | Enforced by |
|---|---|---|
| **I1** | `packages/core-*` never imports `electron` or `react` | ESLint `no-restricted-imports`, checked in CI |
| **I2** | The renderer never holds a token, a key, or a filesystem handle | Preload exposes only the typed IPC registry; no `ipcRenderer` |
| **I3** | No payload leaves the machine without passing the secret gate | A single choke point in `core-ai`; an integration test tries to smuggle a key past it on every CI run |
| **I4** | No byte is written to the user's disk without a checkpoint | `patch.service` is the *only* writer; a test asserts undo restores byte-identical content |

</content>
</invoke>
