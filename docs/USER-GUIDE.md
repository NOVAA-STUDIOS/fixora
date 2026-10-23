# Fixora — User Guide (Beta)

Fixora is a **bring-your-own-key** desktop workspace for understanding and changing code. In the
Problems-panel **Repair** workflow, a proposed repair is checked on a temporary workspace copy and
shown with a verification result before Apply. Other features, including Zappr's separately approved
file plans, have their own execution guarantees described below.

---

## 1. Install

1. Download **Fixora-Setup.exe** from the verified GitHub Release linked by the official site.
2. Production tagged Windows installers are signed and verified before publication. Check the
   publisher/signature in Windows before installing; SmartScreen reputation prompts can still vary.
   Unsigned local development packages are not production downloads.
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
  - a **verdict badge**: **Verified** (the finding is resolved and this file has no new problems —
    verification re-checks the file being changed, not the rest of your project), **Regression**
    (the fix broke syntax or introduced a new problem in this file — you can't apply it), or
    **Unresolved** (this file has no new problems, but the fix didn't take);
  - a **diff** (original vs. proposed);
  - **Apply** (writes just that symbol into your file), **Copy**, or **Reject**.
- **Test** — generate a focused test for the finding.

Only **Verified** repairs offer a safe one-click Apply. If you edit the file after a repair is proposed,
Fixora refuses to apply the now-stale fix and asks you to re-run it — it never splices into code it wasn't
computed against.

## 5. Zappr assistant

Zappr supports chat/review and file/repair planning in the desktop workbench. `Ctrl+I` sends the exact
selected code and its relative file context to Zappr; `@path/to/file` adds explicit file context, with
the active editor file used only as lower-priority fallback. Context is deduplicated for each run.

For file/repair changes, Zappr validates a structured plan and shows its create/edit/delete steps before
anything is changed. **Apply changes** is required to execute it; Reject or cancellation while waiting
for approval does not modify files. Writes are guarded and verified; if a later plan step fails, earlier
plan mutations are rolled back where possible and the result reports rollback status. Review the
displayed paths/actions before applying. This plan approval flow is separate from the verified Repair
panel workflow above.

## 6. History

The **History** panel (clock icon) is your local audit trail: every repair you reviewed, its verdict, and
whether you applied it — newest first. Click one to open its file. It's stored on your machine and
survives restarts.

## 7. Send a suggestion

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

## 8. Your privacy

- Analysis and verification run **locally**.
- The Problems-panel Repair workflow sends its **relevant code slice** (the target symbol + evidence),
  not a full-repository upload, directly to your chosen provider. Zappr may use selected, mentioned,
  active-file, open-tab, and project context as described above.
- The Repair/Proceed AI pipeline applies a **secret gate** to its constructed outbound context and can
  refuse a request containing a recognized API key, private key, or token. Do not assume that gate
  applies to a separate feature unless that feature's implementation uses it.
- Your key is encrypted with your OS keychain; the interface never shows it after you save it.
- Desktop AI code requests go to the selected provider. Fixora account/auth and license validation may
  contact their configured services; these are separate from sending code to an AI provider.
- Telemetry is **off by default**.

Full statement: [privacy page](https://fixora.dev/privacy.html).

## 9. GO/PRO license (optional)

Fixora's Free, GO, and PRO plans have different main-process repair limits. Ordinary GO/PRO license
activation is validated online with Gumroad (the founder/internal key path is a local exception); a
stored paid license is rechecked at app startup when its last successful check is at least 24 hours
old. A network failure does not by itself revoke the plan. See [current licensing details](./LICENSING.md).

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| Windows shows a publisher or reputation warning | v1.2.26 Windows binaries are unsigned and may show an Unknown Publisher warning. For signed releases, verify the downloaded installer signature/publisher; SmartScreen reputation prompts may still occur. Do not treat unsigned local packages as production installers. |
| "Add your provider key in Settings → AI" | You haven't added a key yet — see step 2. |
| A repair was **blocked** | A secret was detected in the code being sent. Fixora names the file and rule; remove/rotate the secret, or exclude that file. This is working as intended. |
| Provider error | Your key may be invalid, out of credit, or the provider is busy. Check the key in Settings → AI and your OpenRouter balance. |
| No findings | Make sure the project has the relevant tools configured (e.g. an ESLint or tsconfig). Fixora runs *your* tools. |
| A fix says **Regression** | The system is working: the fix would break something. Fixora won't let you apply it. |
