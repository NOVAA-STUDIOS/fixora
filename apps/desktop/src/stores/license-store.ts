import type { LicenseStatus } from '@fixora/shared-types';
import { create } from 'zustand';

import { invoke } from '../lib/bridge.js';

/**
 * The license entitlement the renderer reads (Beta). It mirrors the offline-verified status main owns;
 * the renderer never sees or stores the key. `isPro` is derived — the one flag the rest of the app can
 * read to gate a Pro affordance (none is gated in the beta; this is the plumbing v1.1 builds on).
 */
type LicenseState = {
  status: LicenseStatus | null;
  load: () => Promise<void>;
  activate: (key: string) => Promise<LicenseStatus | null>;
  deactivate: () => Promise<void>;
};

export const useLicenseStore = create<LicenseState>((set) => ({
  status: null,
  load: async () => {
    const result = await invoke('license:get', {});
    if (result.ok) set({ status: result.value });
  },
  activate: async (key) => {
    const result = await invoke('license:activate', { key });
    if (!result.ok) return null;
    set({ status: result.value });
    return result.value;
  },
  deactivate: async () => {
    const result = await invoke('license:deactivate', {});
    if (result.ok) set({ status: result.value });
  },
}));

export function isPro(status: LicenseStatus | null): boolean {
  return status?.plan === 'pro' && status.valid;
}
