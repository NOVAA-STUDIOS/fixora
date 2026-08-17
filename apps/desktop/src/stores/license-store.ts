import type { Plan } from '@fixora/shared-types';
import { create } from 'zustand';

import { PRODUCT_IDS, validateLicense } from '../lib/lemonsqueezy.js';

const STORAGE_KEY = 'fixora.license.v1';
export const DAILY_LIMIT: Record<Plan, number> = { free: 10, go: 50, pro: Infinity };

type Stored = { plan: Plan; licenseKey: string | null; repairsToday: number; day: string };

function todayKey(): string {
  return new Date().toLocaleDateString('en-CA');
}

function loadStored(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) throw new Error('none');
    const parsed = JSON.parse(raw) as Stored;
    // A new calendar day since the last write resets the counter — the whole point of "per day".
    if (parsed.day !== todayKey()) return { ...parsed, repairsToday: 0, day: todayKey() };
    return parsed;
  } catch {
    return { plan: 'free', licenseKey: null, repairsToday: 0, day: todayKey() };
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
   * key with no tier picker; whichever LemonSqueezy product it validates against wins. Resolves
   * the activated plan on success, so callers can show a tier-specific confirmation. */
  activate: (licenseKey: string) => Promise<'go' | 'pro' | null>;
  setUpgradeDialogOpen: (open: boolean) => void;
};

const initial = loadStored();
let initialDay = initial.day;

export const useLicenseStore = create<LicenseState>((set, get) => ({
  plan: initial.plan,
  licenseKey: initial.licenseKey,
  repairsToday: initial.repairsToday,
  showUpgradeDialog: false,

  canRepair: () => {
    // A new day since the store was hydrated (app left open overnight) — check live, not just at load.
    if (todayKey() !== initialDay) {
      initialDay = todayKey();
      set({ repairsToday: 0 });
    }
    const { plan, repairsToday } = get();
    return repairsToday < DAILY_LIMIT[plan];
  },

  incrementRepair: () => {
    const repairsToday = get().repairsToday + 1;
    set({ repairsToday });
    persist({ plan: get().plan, licenseKey: get().licenseKey, repairsToday, day: todayKey() });
  },

  activate: async (licenseKey) => {
    for (const [, productId] of Object.entries(PRODUCT_IDS)) {
      const { valid, plan } = await validateLicense(licenseKey, productId);
      if (valid && (plan === 'go' || plan === 'pro')) {
        // Left open (not auto-closed) so the caller can show a confirmation before the user
        // dismisses it themselves.
        set({ plan, licenseKey });
        persist({ plan, licenseKey, repairsToday: get().repairsToday, day: todayKey() });
        return plan;
      }
    }
    return null;
  },

  setUpgradeDialogOpen: (open) => {
    set({ showUpgradeDialog: open });
  },
}));
