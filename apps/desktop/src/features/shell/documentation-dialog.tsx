import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@fixora/ui';

/**
 * The Documentation quick action (Sprint F2: Welcome Experience).
 *
 * Content is a condensed, hand-authored rendering of `docs/USER-GUIDE.md`, not a live read of the
 * file or a Markdown parser over it — the guide is short and changes rarely, and the app ships with
 * zero Markdown/HTML-rendering dependencies today (Standards §2: don't add one to solve a problem
 * this small). It opens **in-app** rather than in a browser so it works with no network connection
 * and needs no addition to the `shell.openExternal` host allowlist.
 *
 * Kept manually in sync with `docs/USER-GUIDE.md` — if that file's steps change, update the section
 * list below in the same PR.
 *
 * The dialog's own copy must not claim `docs/USER-GUIDE.md` is present on the user's machine: the
 * packaged installer (`electron-builder.yml`'s `files:` list) ships only `out/**` and `package.json`
 * — `docs/` is a repo-only path that does not exist in an installed build. An earlier version of
 * this dialog said "ships alongside Fixora as docs/USER-GUIDE.md," which was false for every real
 * install (beta audit A1, Documentation finding 1). The description below makes no claim about
 * where the source file lives.
 */

type Section = { heading: string; body: React.ReactNode };

const SECTIONS: Section[] = [
  {
    heading: '1. Install',
    body: (
      <p>
        Download the installer from the website and run it. The beta is not code-signed yet, so
        Windows SmartScreen may warn on first launch — choose <strong>More info → Run anyway</strong>.
      </p>
    ),
  },
  {
    heading: '2. Add your AI key (one time)',
    body: (
      <p>
        Fixora uses <strong>your</strong> provider key, stored encrypted in your OS keychain — it
        never leaves your machine except to call the provider you choose. Get an OpenRouter key at
        openrouter.ai, then in <strong>Settings → AI</strong>, paste it and pick a model.
      </p>
    ),
  },
  {
    heading: '3. Open a project and analyze it',
    body: (
      <p>
        <strong>Open folder</strong> and choose a real repository, then open the Problems panel and
        click <strong>Run analysis</strong>. Findings come from your own ESLint, TypeScript, ruff,
        mypy, go vet, and Fixora&apos;s complexity checks — no AI is involved at this step.
      </p>
    ),
  },
  {
    heading: '4. Repair a finding',
    body: (
      <p>
        Hover a finding and choose <strong>Explain</strong>, <strong>Repair</strong>, or{' '}
        <strong>Test</strong>. Every repair is verified — applied to a throwaway copy and re-checked
        with your own tools — before you can apply it. Only a <strong>Verified</strong> repair offers
        a one-click Apply.
      </p>
    ),
  },
  {
    heading: '5. History',
    body: (
      <p>
        The History panel is your local audit trail: every repair you reviewed, its verdict, and
        whether you applied it. It is stored on your machine and survives restarts.
      </p>
    ),
  },
  {
    heading: '6. Send a suggestion',
    body: (
      <p>
        The Suggest panel is where feature requests and bug notes go. Every suggestion is saved
        locally only; from there you can <strong>Email to Fixora</strong> or export it to a JSON file.
      </p>
    ),
  },
  {
    heading: '7. Your privacy',
    body: (
      <p>
        Analysis and verification run locally. An AI repair sends only the relevant code slice to
        your chosen provider — never your whole repository — and a secret gate refuses to send any
        payload containing an API key, private key, or token.
      </p>
    ),
  },
];

export function DocumentationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <div className="flex flex-col gap-1 pb-4">
          <DialogTitle className="text-base font-semibold text-fg">Documentation</DialogTitle>
          <DialogDescription className="text-sm text-fg-secondary">
            The essentials, condensed for a quick reference without leaving the app.
          </DialogDescription>
        </div>
        <div className="flex flex-col gap-4">
          {SECTIONS.map((section) => (
            <section key={section.heading} className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-fg">{section.heading}</h3>
              <div className="text-sm leading-relaxed text-fg-secondary">{section.body}</div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
