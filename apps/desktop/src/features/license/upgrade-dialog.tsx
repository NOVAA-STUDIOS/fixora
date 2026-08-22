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
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#000000] p-6">
        <h2 className="text-lg font-semibold text-white">You've hit this window's free-tier limit</h2>
        <p className="mt-1 text-sm text-white/50">
          {resetCountdown === null
            ? 'Upgrade for more repairs every 3 hours.'
            : `${resetCountdown}. Upgrade for more repairs every 3 hours.`}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => {
              startCheckout(CHECKOUT_URLS.go);
            }}
            className="rounded-xl border border-white/10 p-4 text-left hover:bg-white/[0.04]"
          >
            <div className="text-sm font-medium text-white">GO</div>
            <div className="mt-1 text-xs text-white/50">50 repairs/3h</div>
            <div className="mt-2 text-base font-semibold text-white">$2.99</div>
          </button>
          <button
            type="button"
            onClick={() => {
              startCheckout(CHECKOUT_URLS.pro);
            }}
            className="rounded-xl border border-white/10 p-4 text-left hover:bg-white/[0.04]"
          >
            <div className="text-sm font-medium text-white">PRO</div>
            <div className="mt-1 text-xs text-white/50">Unlimited repairs</div>
            <div className="mt-2 text-base font-semibold text-white">$4.99</div>
          </button>
        </div>

        <div className="mt-5 flex gap-2">
          <input
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
            }}
            placeholder="License key"
            className="flex-1 rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white placeholder:text-white/30"
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
            className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-black hover:opacity-90"
          >
            Activate
          </button>
        </div>
        {success !== null && <p className="mt-2 text-sm text-[#34d399]">{success}</p>}
        {error !== null && <p className="mt-2 text-sm text-[#ef4444]">{error}</p>}

        <button
          type="button"
          onClick={() => {
            setOpen(false);
          }}
          className="mt-4 text-sm text-white/40 hover:text-white/70"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
