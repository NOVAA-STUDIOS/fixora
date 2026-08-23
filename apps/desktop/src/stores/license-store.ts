import type { Plan } from '@fixora/shared-types';
import { create } from 'zustand';

import { invoke, subscribe } from '../lib/bridge.js';
import { PRODUCT_PERMALINKS, validateLicense } from '../lib/gumroad.js';

import { toast } from './toast-store.js';

const STORAGE_KEY = 'fixora.license.v1';
export const DAILY_LIMIT: Record<Plan, number> = { free: 10, go: 50, pro: Infinity };

/** Rolling window, not a calendar day: the count resets 3h after the FIRST repair in the current
 * window, not at midnight. */
export const REPAIR_WINDOW_MS = 3 * 60 * 60 * 1000;

type Stored = { plan: Plan; licenseKey: string | null; repairsToday: number; windowStart: number };

function loadStored(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) throw new Error('none');
    const parsed = JSON.parse(raw) as Stored;
    // The window elapsed since this was last written — reset live, not just at load.
    if (Date.now() - parsed.windowStart >= REPAIR_WINDOW_MS) {
      return { ...parsed, repairsToday: 0, windowStart: Date.now() };
    }
    return parsed;
  } catch {
    return { plan: 'free', licenseKey: null, repairsToday: 0, windowStart: Date.now() };
  }
}

function persist(state: Stored): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

type LicenseState = {
  plan: Plan;
  licenseKey: string | null;
  repairsToday: number;
  showUpgradeDialog: boolean;
  canRepair: () => boolean;
  incrementRepair: () => void;
  /** Tries the key against GO, then PRO — the caller (Settings, the upgrade dialog) supplies one
   * key with no tier picker; whichever Gumroad product it validates against wins. Resolves
   * the activated plan on success, so callers can show a tier-specific confirmation. */
  activate: (licenseKey: string) => Promise<'go' | 'pro' | null>;
  setUpgradeDialogOpen: (open: boolean) => void;
  /** Pulls the authoritative count from main. See `syncFromMain` below. */
  syncFromMain: () => Promise<void>;
};

const initial = loadStored();
let windowStart = initial.windowStart;

export const useLicenseStore = create<LicenseState>((set, get) => ({
  plan: initial.plan,
  licenseKey: initial.licenseKey,
  repairsToday: initial.repairsToday,
  showUpgradeDialog: false,

  canRepair: () => {
    // The window may have elapsed since the store was hydrated (app left open) — check live.
    if (Date.now() - windowStart >= REPAIR_WINDOW_MS) {
      windowStart = Date.now();
      set({ repairsToday: 0 });
    }
    const { plan, repairsToday } = get();
    return repairsToday < DAILY_LIMIT[plan];
  },

  incrementRepair: () => {
    const repairsToday = get().repairsToday + 1;
    set({ repairsToday });
    persist({ plan: get().plan, licenseKey: get().licenseKey, repairsToday, windowStart });
  },

  activate: async (licenseKey) => {
    for (const [, permalink] of Object.entries(PRODUCT_PERMALINKS)) {
      const { valid, plan } = await validateLicense(licenseKey, permalink);
      if (valid && (plan === 'go' || plan === 'pro')) {
        // Left open (not auto-closed) so the caller can show a confirmation before the user
        // dismisses it themselves.
        set({ plan, licenseKey });
        persist({ plan, licenseKey, repairsToday: get().repairsToday, windowStart });
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
    const { repairsToday } = result.value;
    set({ repairsToday });
    persist({ plan: get().plan, licenseKey: get().licenseKey, repairsToday, windowStart });
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
  const { repairsToday } = useLicenseStore.getState();
  useLicenseStore.setState({ plan: 'free', licenseKey: null });
  persist({ plan: 'free', licenseKey: null, repairsToday, windowStart });
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
