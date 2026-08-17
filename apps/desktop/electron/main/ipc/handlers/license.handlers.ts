import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { registerHandler } from '../router.js';

const VALIDATE_URL = 'https://api.lemonsqueezy.com/v1/licenses/validate';
const PRODUCT_TO_PLAN: Record<string, 'go' | 'pro'> = {
  '1296461': 'go',
  '1296487': 'pro',
};

/** Today, in the local calendar day, as a stable key for the free-tier counter. */
function todayKey(): string {
  return new Date().toLocaleDateString('en-CA');
}

interface Stored {
  day: string;
  repairsToday: number;
}

/**
 * Persisted to disk (not the renderer's `localStorage`, which `localStorage.clear()` or DevTools
 * defeats in one line) — a plain JSON file in `userData`, main-owned, the same trust boundary as
 * the rest of the app's on-disk state. `dir` is passed in rather than read from `app.getPath`
 * here, so this module stays testable without an Electron runtime.
 */
export function createRepairCounter(dir: string): {
  increment: () => number;
  get: () => number;
  resetIfNewDay: () => void;
} {
  const file = join(dir, 'repair-count.json');

  function load(): Stored {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Stored>;
      if (typeof parsed.day === 'string' && typeof parsed.repairsToday === 'number') {
        return parsed as Stored;
      }
    } catch {
      // No file yet, or a corrupt one — start the count at zero rather than crash.
    }
    return { day: todayKey(), repairsToday: 0 };
  }

  function save(state: Stored): void {
    writeFileSync(file, JSON.stringify(state), 'utf8');
  }

  let state = load();
  if (state.day !== todayKey()) state = { day: todayKey(), repairsToday: 0 };

  return {
    increment: () => {
      if (state.day !== todayKey()) state = { day: todayKey(), repairsToday: 0 };
      state = { ...state, repairsToday: state.repairsToday + 1 };
      save(state);
      return state.repairsToday;
    },
    get: () => {
      if (state.day !== todayKey()) state = { day: todayKey(), repairsToday: 0 };
      return state.repairsToday;
    },
    resetIfNewDay: () => {
      if (state.day !== todayKey()) {
        state = { day: todayKey(), repairsToday: 0 };
        save(state);
      }
    },
  };
}

let counter: ReturnType<typeof createRepairCounter> | null = null;
let midnightTimer: ReturnType<typeof setTimeout> | null = null;

/** Called from `ai.handlers.ts` on a successful `ai:applyRepair` — the one place a repair is
 * actually committed, so this is the one place the count is actually trustworthy to bump. */
export function incrementRepairCount(): number {
  return counter?.increment() ?? 0;
}

function scheduleMidnightReset(): void {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  midnightTimer = setTimeout(() => {
    counter?.resetIfNewDay();
    scheduleMidnightReset();
  }, next.getTime() - now.getTime());
}

export function registerLicenseHandlers(deps: { dir: string }): void {
  counter = createRepairCounter(deps.dir);
  scheduleMidnightReset();

  registerHandler('license:validate', async ({ licenseKey, productId }) => {
    const plan = PRODUCT_TO_PLAN[productId];
    if (plan === undefined) return { valid: false, plan: null };

    try {
      const res = await fetch(VALIDATE_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ license_key: licenseKey }),
      });
      if (!res.ok) return { valid: false, plan: null };
      const body = (await res.json()) as {
        valid?: boolean;
        meta?: { product_id?: number };
      };
      const matchesProduct = String(body.meta?.product_id ?? '') === productId;
      return { valid: body.valid === true && matchesProduct, plan: body.valid === true && matchesProduct ? plan : null };
    } catch (error) {
      console.error('[license] validate request failed', { message: (error as Error).message });
      return { valid: false, plan: null };
    }
  });

  registerHandler('license:getRepairCount', () => ({ repairsToday: counter?.get() ?? 0 }));
}
