import { Button } from '@fixora/ui';
import { useEffect, useState } from 'react';

import { invoke } from '../../lib/bridge.js';

/**
 * The first-run agreement.
 *
 * Rendered INSTEAD of the app, not over it. A modal the user can click behind, tab out of, or
 * dismiss with Escape is not an agreement — it is a notice with a checkbox, and the difference
 * matters for the one screen whose whole purpose is recording a decision.
 *
 * Three states, and the middle one is why this is not just a boolean: while the answer is unknown
 * the shell renders nothing at all. Showing the app first and the agreement a beat later would mean
 * the user had already used it before agreeing; showing the agreement first and hiding it a beat
 * later would flash a legal prompt at everyone on every launch.
 */
const TERMS_URL = 'https://novaa-studios.github.io/fixora/terms.html';
const PRIVACY_URL = 'https://novaa-studios.github.io/fixora/privacy.html';

export function ConsentGate({ children }: { children: React.ReactNode }): React.JSX.Element | null {
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void invoke('consent:get', {}).then((result) => {
      if (!live) return;
      // A failed read is treated as "not accepted" — the safe direction. Asking twice costs a click;
      // never asking means claiming an agreement that was never given.
      setAccepted(result.ok ? result.value.accepted : false);
    });
    return () => {
      live = false;
    };
  }, []);

  if (accepted === null) return null;
  if (accepted) return <>{children}</>;

  const agree = async (): Promise<void> => {
    setBusy(true);
    const result = await invoke('consent:accept', {});
    // Only proceeds if main confirms the acceptance was recorded. If the write failed, the user is
    // asked again next launch rather than the app silently continuing on an unsaved agreement.
    if (result.ok && result.value.accepted) setAccepted(true);
    else setBusy(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
      className="flex h-screen w-screen items-center justify-center bg-canvas p-6 text-fg"
    >
      <div className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-border-subtle bg-raised p-6">
        <h1 id="consent-title" className="text-base font-semibold">
          Welcome to Fixora
        </h1>

        <p className="text-sm leading-relaxed text-fg-secondary">
          By using Fixora, you agree to our{' '}
          {/* target=_blank routes through main's guarded `openExternal` (navigation-guard.ts), so
              these open in the real browser and never navigate the app window. */}
          <a
            href={TERMS_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent-text hover:underline"
          >
            Terms of Service
          </a>{' '}
          and{' '}
          <a
            href={PRIVACY_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent-text hover:underline"
          >
            Privacy Policy
          </a>
          .
        </p>

        <p className="text-xs leading-relaxed text-fg-muted">
          Fixora analyses your code on this machine. Code is sent only to the AI provider you
          configure, using your own key — never to us.
        </p>

        <div className="mt-2 flex items-center justify-end gap-2">
          {/* Declining quits, which is what "I do not agree" means for terms covering use itself. */}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void invoke('consent:decline', {})}
          >
            Exit
          </Button>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void agree()}>
            I Agree
          </Button>
        </div>
      </div>
    </div>
  );
}
