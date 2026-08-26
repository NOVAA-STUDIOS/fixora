import type { Plan } from '@fixora/shared-types';
import { create } from 'zustand';

import { invoke, subscribe } from '../lib/bridge.js';
import { PRODUCT_PERMALINKS, validateLicense } from '../lib/gumroad.js';

import { toast } from './toast-store.js';

const STORAGE_KEY = 'fixora.license.v1';

/**
 * The renderer's own copy of the per-plan ceiling, for the pre-flight UX check only (`canRepair`).
 * Enforcement — the count that actually gates a repair — lives solely in main's `repair-limit.ts`
 * (`PLAN_LIMIT`, `checkAndIncrementRepairLimit`); this never increments and is never authoritative.
 */
export const PLAN_REPAIR_LIMIT: Record<Plan, number> = { free: 10, go: 50, pro: Infinity };

/** What survives a restart: which plan is active, and the key that proved it. The repair count is
 *  NOT part of this — it is main's authoritative count, re-fetched fresh via `syncFromMain` on
 *  every launch, never written to disk here. */
type PersistedLicense = { plan: Plan; licenseKey: string | null };

function loadPersistedLicense(): PersistedLicense {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) throw new Error('none');
    const parsed = JSON.parse(raw) as Partial<PersistedLicense>;
    const plan: Plan = parsed.plan === 'go' || parsed.plan === 'pro' ? parsed.plan : 'free';
    const licenseKey = typeof parsed.licenseKey === 'string' ? parsed.licenseKey : null;
    return { plan, licenseKey };
  } catch {
    return { plan: 'free', licenseKey: null };
  }
}

function persistLicense(state: PersistedLicense): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

type LicenseState = {
  plan: Plan;
  licenseKey: string | null;
  repairsToday: number;
  showUpgradeDialog: boolean;
  canRepair: () => boolean;
  /** Tries the key against GO, then PRO — the caller (Settings, the upgrade dialog) supplies one
   * key with no tier picker; whichever Gumroad product it validates against wins. Resolves
   * the activated plan on success, so callers can show a tier-specific confirmation. */
  activate: (licenseKey: string) => Promise<'go' | 'pro' | null>;
  setUpgradeDialogOpen: (open: boolean) => void;
  /** Pulls the authoritative count from main. See `syncFromMain` below. */
  syncFromMain: () => Promise<void>;
};

const initial = loadPersistedLicense();

export const useLicenseStore = create<LicenseState>((set, get) => ({
  plan: initial.plan,
  licenseKey: initial.licenseKey,
  // Not persisted — main's `repair-limit.ts` is the sole authority on this count. Zero until
  // `syncFromMain` (called on launch) fetches the real value.
  repairsToday: 0,
  showUpgradeDialog: false,

  canRepair: () => {
    const { plan, repairsToday } = get();
    return repairsToday < PLAN_REPAIR_LIMIT[plan];
  },

  activate: async (licenseKey) => {
    for (const [, permalink] of Object.entries(PRODUCT_PERMALINKS)) {
      const { valid, plan } = await validateLicense(licenseKey, permalink);
      if (valid && (plan === 'go' || plan === 'pro')) {
        // Left open (not auto-closed) so the caller can show a confirmation before the user
        // dismisses it themselves.
        set({ plan, licenseKey });
        persistLicense({ plan, licenseKey });
        return plan;
      }
    }
    return null;
  },

  setUpgradeDialogOpen: (open) => {
    set({ showUpgradeDialog: open });
  },

  /**
   * Replace the local count with main's.
   *
   * This store kept its own `repairsToday` in `localStorage`, and main kept its own in
   * `repair-count.json`. Two counters, incremented independently, and the UI rendered the WRONG
   * one — the renderer's, which no longer gates anything since enforcement moved to main. That is
   * how the panel could read 269/10 while the file on disk said 0.
   *
   * Main is the authority; this value is display only. Failure is silent on purpose: a count that
   * could not be refreshed should keep showing its last known value, not throw away the UI.
   */
  syncFromMain: async () => {
    const result = await invoke('license:getRepairCount', {});
    if (!result.ok) return;
    set({ repairsToday: result.value.repairsToday });
  },
}));

/**
 * Main holds no paid plan for this device. If we still have the key, re-validate silently — the
 * user bought this and should not have to do anything. If we don't, say so once, quietly: a paid
 * user being metered as free without explanation is the worse failure of the two.
 */
/**
 * Main's periodic Gumroad check rejected the stored licence — it has ALREADY reverted the plan, so
 * this only makes the UI agree. The local key is cleared too: keeping it would leave Settings
 * showing an activated licence that no longer unlocks anything.
 */
export function listenForPlanRevoked(): () => void {
  return subscribe('license:planRevoked', () => {
    set_planToFree();
    toast.error(
      'Your license could not be verified',
      "You've been moved to the free tier. Re-activate in Settings → License if this looks wrong.",
    );
  });
}

function set_planToFree(): void {
  useLicenseStore.setState({ plan: 'free', licenseKey: null });
  persistLicense({ plan: 'free', licenseKey: null });
}

export function listenForRevalidation(): () => void {
  return subscribe('license:revalidateNeeded', () => {
    const { licenseKey, plan, activate } = useLicenseStore.getState();
    if (licenseKey === null || licenseKey === '') {
      // Never seen a key here either — this is simply a free user, not a lost plan.
      if (plan !== 'free') {
        toast.error(
          'Re-activate your license',
          'Open Settings → License and enter your key to restore your plan.',
        );
      }
      return;
    }
    void activate(licenseKey).then((restored) => {
      if (restored === null) {
        toast.error(
          'Re-activate your license',
          'Your saved license key could not be verified. Open Settings → License to re-enter it.',
        );
      }
    });
  });
}
