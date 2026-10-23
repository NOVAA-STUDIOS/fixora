import { useState } from 'react';

import { useAuthStore } from '../../features/auth/auth-store.js';
import { invoke } from '../../lib/bridge.js';
import { useLicenseStore } from '../../stores/license-store.js';

import { useResetCountdown } from './use-reset-countdown.js';

const CHECKOUT_URLS = {
  go: 'https://rohanstar558.gumroad.com/l/euprne',
  pro: 'https://rohanstar558.gumroad.com/l/bqbxp',
} as const;

const ACTIVATION_MESSAGE: Record<'go' | 'pro', string> = {
  go: 'Fixora GO activated! You now have 50 repairs/3h.',
  pro: 'Fixora PRO activated! Unlimited repairs unlocked.',
};

/** Shown when `canRepair()` goes false — the free tier's 10-repairs/3h ceiling. */
export function UpgradeDialog(): React.JSX.Element | null {
  const open = useLicenseStore((s) => s.showUpgradeDialog);
  const setOpen = useLicenseStore((s) => s.setUpgradeDialogOpen);
  const activate = useLicenseStore((s) => s.activate);
  const authUser = useAuthStore((s) => s.user);
  const setShowSignIn = useAuthStore((s) => s.setShowSignIn);
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Above the early return: a hook after a conditional `return null` would be skipped on the
  // closed render and change hook order between renders.
  const resetCountdown = useResetCountdown();

  if (!open) return null;

  // A purchase ties a license to a buyer — sign-in first so it lands on their account, not an
  // anonymous checkout no one can recover if the key is lost.
  const startCheckout = (url: string): void => {
    if (authUser === null) {
      setShowSignIn(true);
      return;
    }
    void invoke('system:openExternal', { url });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md rounded-2xl border border-border-subtle bg-raised p-6 text-fg shadow-2xl">
        <h2 className="text-lg font-semibold text-fg">You've hit this window's free-tier limit</h2>
        <p className="mt-1 text-sm text-fg-muted">
          {resetCountdown === null
            ? 'Upgrade for more repairs every 3 hours.'
            : `${resetCountdown}. Upgrade for more repairs every 3 hours.`}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="flex flex-col rounded-xl border border-border-subtle bg-canvas p-4">
            <div className="text-sm font-medium text-fg">GO — $2.99/mo</div>
            <ul className="mt-1 flex flex-col gap-0.5 text-xs text-fg-muted">
              <li>50 repairs / 3 hours</li>
              <li>All AI providers</li>
            </ul>
            <button
              type="button"
              onClick={() => {
                startCheckout(CHECKOUT_URLS.go);
              }}
              className="mt-3 rounded-lg border border-border-strong bg-raised px-3 py-1.5 text-xs font-medium text-fg hover:bg-hover"
            >
              Upgrade to GO →
            </button>
          </div>
          <div className="flex flex-col rounded-xl border border-accent-border bg-accent-subtle/30 p-4">
            <div className="text-sm font-medium text-fg">PRO — $4.99/mo</div>
            <ul className="mt-1 flex flex-col gap-0.5 text-xs text-fg-muted">
              <li>Unlimited repairs</li>
              <li>Priority support</li>
            </ul>
            <button
              type="button"
              onClick={() => {
                startCheckout(CHECKOUT_URLS.pro);
              }}
              className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-hover"
            >
              Upgrade to PRO →
            </button>
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <input
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
            }}
            placeholder="License key"
            className="min-w-0 flex-1 rounded-xl border border-border-strong bg-inset px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-muted focus-visible:outline-2 focus-visible:outline-focus-ring"
          />
          <button
            type="button"
            onClick={() => {
              void activate(key).then((plan) => {
                if (plan === null) {
                  setError('Invalid license key. Purchase at rohanstar558.gumroad.com');
                  setSuccess(null);
                  return;
                }
                setError(null);
                setSuccess(ACTIVATION_MESSAGE[plan]);
              });
            }}
            className="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
          >
            Activate
          </button>
        </div>
        {success !== null && <p className="mt-2 text-sm text-success-text">{success}</p>}
        {error !== null && <p className="mt-2 text-sm text-danger-text">{error}</p>}

        <button
          type="button"
          onClick={() => {
            setOpen(false);
          }}
          className="mt-4 text-sm text-fg-muted hover:text-fg"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
