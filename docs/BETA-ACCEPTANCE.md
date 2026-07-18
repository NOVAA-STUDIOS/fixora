# Fixora Beta-M5 — Acceptance, Audit & Red-Team (Phase F)

Status as of 2026-07-18. The verified-repair pipeline (BYOK) is the beta product; this records how it
was verified, what the internal audit found and fixed, and the red-team of the beta surface.

---

## 1. Acceptance

### 1.1 What was verified autonomously

Each real subsystem was exercised for real (not just unit-mocked):

| Layer | How it was verified | Result |
| ----- | ------------------- | ------ |
| BYOK transport (OpenRouter) | A local server speaks the OpenRouter **SSE wire format**, split across writes; the **real adapter** fetches it over a real socket and parses the stream (`openrouter.acceptance.test.ts`). Runs through the real pipeline: `buildContext → secret gate → prepareRequest → stream → parseRepairOutput`. | ✅ deltas + usage + a schema-valid repair round-trip |
| Secret gate | Live-key smuggle suite: 11 credential shapes blocked with the rule named, git-SHA false-positive guarded, denied paths + evidence scanned; block never carries the secret. | ✅ merge-blocking |
| Verified repair (overlay + analyzers) | Live Electron **utility-process worker** verifying a patch on a real overlay: a valid patch → `syntaxOk`, a broken patch → `regression`, worker exits clean. | ✅ real tree-sitter verdict |
| Keychain (BYOK at rest) | Live `safeStorage` (DPAPI) round-trip; ciphertext ≠ plaintext. | ✅ |
| Apply to disk | Red-team of `ai:applyRepair` through the real handler (below). | ✅ |

**The one thing not machine-verifiable is a real LLM's answer quality.** That is the owner's own-key
run (§1.2). Everything the app *does* with whatever the model returns — gate, stream, parse, verify,
diff, apply, record — is verified above.

### 1.2 Real-key end-to-end (owner-run) — safe procedure

> **Never paste an API key into a chat, an issue, or a commit.** The only place a key belongs is the
> app's own field, from which it goes straight to the OS keychain and is never returned.

1. Get an **OpenRouter** key at `openrouter.ai` (starts `sk-or-v1-…`).
2. Launch the beta build (`pnpm --filter @fixora/desktop dev`, or the installer once packaged).
3. **Settings → AI** → paste the key → Save. It is encrypted with the OS keychain; the field then shows
   only a `••••` hint. Pick a model.
4. Open a **real repository** (one of yours) and **Run analysis** (Problems panel).
5. On a real finding, click **Repair**. Expect: a streamed run, then a **diff with a verdict badge**
   (Verified / Regression / Unresolved) and the "verified against …" line.
6. Confirm the four claims:
   - **Verified** repairs enable **Apply**; **Regression** disables it.
   - **Apply** writes only the target range; the editor reloads; the file compiles.
   - **Explain** streams prose; **Test** returns a test.
   - **History** lists the repair with its verdict and (after apply) an "applied" mark, and survives a
     restart.
7. **Privacy check** (the trust claim): with the OS network tools, confirm the only outbound connection
   during a run is to the provider you chose — nothing to a Fixora server (there is none on the AI path).
8. **Secret-gate check**: put a live-looking key (e.g. `AKIA…`) in a file, and run Repair on a finding in
   it — the run must be **blocked**, naming the file and rule, with nothing sent.

Record pass/fail against steps 5–8; those are the beta's acceptance criteria.

---

## 2. Internal audit — verified-repair pipeline

| # | Area | Finding | Resolution |
| - | ---- | ------- | ---------- |
| A1 | **Stale apply** | `ai:applyRepair` spliced by line range against the *current* file; if the file changed after the proposal, the range was stale and could corrupt the file. | **Fixed.** Apply now carries `expectedOriginal` (the text the range held at proposal time) and main refuses if the current range no longer matches. Red-teamed (§3). |
| A2 | Path safety on write | Apply is the only code that writes user files. | Uses the same `assertInsideWorkspace` + secrets-denylist guards as reads; red-teamed (§3). Writes an existing file only, never creates. |
| A3 | Overlay isolation | Verification must never touch real files. | Overlay is a temp copy; `node_modules` junction-linked; disposed in `finally`. Test asserts the real file is untouched. |
| A4 | Verdict soundness | A broken fix must never read as verified. | Syntax break (`tree-sitter hasError`) is always a regression, even with no analyzer configured. Worker error → `skipped`, never a false `verified`. Comparison is by `source:rule:symbol`, not the snippet-sensitive DB id. |
| A5 | Gate placement | The gate must be unbypassable. | `prepareRequest` is the single constructor of a provider request and runs the gate first; there is no other path to a `ProviderRequest` in the pipeline. |
| A6 | Model output → disk | Could the model emit a secret into `repairedCode` that Apply writes out? | Low risk: it is written **locally** to the user's own file and shown in the diff first; nothing is sent outward. Noted, not gated, for the beta. |
| A7 | Key handling | The key must never reach the renderer. | `AiConfig` has no key field (type-enforced); the key is decrypted in main only, at call time. |

---

## 3. Red-team — beta surface (the renderer is hostile, invariant I1)

Automated adversarial tests (`ai-apply-redteam.test.ts`) drive the **real** `ai:applyRepair` handler:

| Attack | Expected | Result |
| ------ | -------- | ------ |
| Path traversal target (`../../evil.txt`) | Refused by the path guard; no write outside the workspace | ✅ throws |
| Write over a secret (`.env`) | Refused by the secrets denylist; the secret file untouched | ✅ throws, file unchanged |
| Stale apply (file changed since proposal) | Refused (A1 guard); file left exactly as-is | ✅ throws `/changed/`, file unchanged |
| Fresh apply (range still matches) | Writes the target range; marks history applied | ✅ |

Plus the standing red-team already in the suite: IPC payloads are zod-validated both directions; a
non-top-frame IPC call is rejected; the preload exposes no `ipcRenderer`; the secret gate blocks the
smuggle suite; CSP has no `unsafe-inline` script-src.

---

## 4. Result

No **critical** issue remains open. A1 (stale apply) was the one correctness risk found and is fixed +
red-teamed. The remaining pre-release items are packaging/website/docs/licensing (tracked in
PROJECT_STATUS), not pipeline defects. The owner's real-key run (§1.2) is the final acceptance gate
before public release.
