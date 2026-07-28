# Fixora — User Guide (Beta)

Fixora fixes your code with AI you can trust. Unlike a chatbot, **every repair is verified** — applied to
a throwaway copy of your project and re-checked with your own linters and type-checker — before you apply
it. It's **bring-your-own-key**: your code goes straight to the AI provider you choose, never through a
Fixora server.

---

## 1. Install

1. Download **Fixora-Setup-&lt;version&gt;.exe** from the website and run it.
2. The beta isn't code-signed yet, so Windows SmartScreen may warn on first launch. Click
   **More info → Run anyway**. (Signing arrives with the paid launch.)
3. Fixora opens to the workspace screen.

## 2. Add your AI key (one time)

Fixora uses **your** provider key, stored encrypted in your OS keychain — it never leaves your machine
except to call the provider.

1. Get an **OpenRouter** key at [openrouter.ai](https://openrouter.ai) (it looks like `sk-or-v1-…`).
   OpenRouter gives you OpenAI, Anthropic, and Google models with one key.
2. In Fixora: **Settings** (gear icon) → **AI** → paste your key → **Save**, and pick a model.
   The key field then shows only a `••••` hint — it's in your keychain now.

## 3. Open a project and analyze it

1. **Open folder** and choose a real repository.
2. Open the **Problems** panel (the alert icon) and click **Run analysis**.
3. Findings appear — from your own ESLint, TypeScript, ruff, mypy, go&nbsp;vet, and Fixora's complexity
   checks. This is the deterministic layer; there's **no AI** here, and it's genuinely useful on its own.

## 4. Repair a finding

Hover a finding and choose an action:

- **Explain** — a plain-English explanation of what's wrong and how to fix it (streamed).
- **Repair** — a proposed fix. Fixora **verifies** it and shows the result in the AI panel:
  - a **verdict badge**: **Verified** (the finding is resolved and nothing new broke),
    **Regression** (the fix broke syntax or introduced a new problem — you can't apply it), or
    **Unresolved** (nothing broke, but the fix didn't take);
  - a **diff** (original vs. proposed);
  - **Apply** (writes just that symbol into your file), **Copy**, or **Reject**.
- **Test** — generate a focused test for the finding.

Only **Verified** repairs offer a safe one-click Apply. If you edit the file after a repair is proposed,
Fixora refuses to apply the now-stale fix and asks you to re-run it — it never splices into code it wasn't
computed against.

## 5. History

The **History** panel (clock icon) is your local audit trail: every repair you reviewed, its verdict, and
whether you applied it — newest first. Click one to open its file. It's stored on your machine and
survives restarts.

## 6. Send a suggestion

The **Suggest** panel (lightbulb icon) is where feature requests, bug notes, and general feedback about
Fixora go — pick a category, write what's on your mind, and send it. No project needs to be open to use
it.

Every suggestion is saved **locally only** — Fixora never sends anything automatically. From your history
below the form, you get two ways to actually share it:

- **Email to Fixora** — opens your default mail client with a pre-filled email (category, your
  suggestion, your Fixora version, OS, open project name, and a timestamp) addressed to us. Review
  it and hit send from your own mail app,
  just like forwarding any other email. If Fixora can't find a mail app configured on your computer, it
  tells you so directly and offers **Open Gmail** (opens the same pre-filled email in Gmail's website,
  in your browser — handy if you have a Gmail account but no desktop mail app), plus **Copy Email
  Address**, **Copy Subject**, and **Copy Message** buttons so you can send it yourself another way.
- **Export JSON** — saves a copy of your suggestions to a file of your choosing, unchanged from before.

## 7. Your privacy

- Analysis and verification run **locally**.
- An AI repair sends only the **relevant code slice** (the target symbol + its evidence — never your whole
  repo) directly to your chosen provider.
- A **secret gate** scans every outbound payload and **refuses to send** a file containing an API key,
  private key, or token — it tells you which file and which rule stopped it.
- Your key is encrypted with your OS keychain; the interface never shows it after you save it.
- Nothing about your code is logged or sent to Fixora. Telemetry is **off by default**.

Full statement: [privacy page](https://fixora.dev/privacy.html).

## 8. Supporter license (optional)

Fixora is free with your own key. A one-time **Supporter/Pro** license funds development and locks in
early-supporter benefits. Buy it on the website, then **Settings → License → paste key → Activate**. It's
verified offline — no account, nothing calls home.

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| SmartScreen blocks the installer | **More info → Run anyway** (unsigned beta). |
| "Add your provider key in Settings → AI" | You haven't added a key yet — see step 2. |
| A repair was **blocked** | A secret was detected in the code being sent. Fixora names the file and rule; remove/rotate the secret, or exclude that file. This is working as intended. |
| Provider error | Your key may be invalid, out of credit, or the provider is busy. Check the key in Settings → AI and your OpenRouter balance. |
| No findings | Make sure the project has the relevant tools configured (e.g. an ESLint or tsconfig). Fixora runs *your* tools. |
| A fix says **Regression** | The system is working: the fix would break something. Fixora won't let you apply it. |
