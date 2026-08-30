import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

import type { Plan } from '@fixora/shared-types';

import type { SqliteDriver } from '../db/driver.js';
import { createRepairLimitRepository, createReferralRepository } from '../db/repositories.js';

/**
 * The repair limit, enforced in MAIN.
 *
 * It used to live only in the renderer (`license-store.ts`'s `canRepair`, read from
 * `localStorage`), which meant the paywall was a value the untrusted side owned: one line in
 * DevTools set `plan: 'pro'` permanently, and the MCP server — which never touches the renderer at
 * all — walked past it entirely. Both counter AND plan are main-owned here, in SQLite, and every
 * repair path gates on `checkAndIncrementRepairLimit` before a provider is ever called.
 *
 * Storage moved from a plain `repair-count.json` file to the `repair_limit` table (migration v10):
 * the file had no protection against a concurrent writer (a `--mcp` standalone process sharing the
 * same userData dir), where SQLite's own locking makes that the driver's problem instead of ours.
 *
 * The renderer keeps its own copy for UX (showing the upgrade dialog before a doomed round trip);
 * this is the enforcement.
 */

/** Rolling window, not a calendar day: the count resets 3h after the FIRST repair in the window. */
export const REPAIR_WINDOW_MS = 3 * 60 * 60 * 1000;

export const PLAN_LIMIT: Record<Plan, number> = { free: 10, go: 50, pro: Infinity };

export interface Stored {
  windowStart: number;
  repairsToday: number;
  plan: Plan;
  /** The key the plan was granted for, kept so it can be re-checked against Gumroad later. Stored
   *  in plaintext beside `plan`, which is itself plaintext — encrypting one and not the other would
   *  buy nothing, since editing `plan` directly is the shorter path anyway. */
  licenseKey?: string;
  /** Epoch ms of the last SUCCESSFUL Gumroad check. Absent until one has happened. */
  lastValidatedAt?: number;
}

/** How long a validated licence is trusted before it is checked again. A day is short enough that
 *  a refund stops working promptly, and long enough that normal use is never gated on the network. */
export const REVALIDATION_INTERVAL_MS = 24 * 60 * 60 * 1000;

function isPlan(value: unknown): value is Plan {
  return value === 'free' || value === 'go' || value === 'pro';
}

function freshFreeState(): Stored {
  return { windowStart: Date.now(), repairsToday: 0, plan: 'free' };
}

/** The same validation `load()` always applied, factored out so the one-time JSON migration can
 *  reuse it on the old file's contents rather than trusting them blind. */
function sanitize(parsed: Partial<Stored>): Stored | null {
  const { windowStart, repairsToday } = parsed;
  // `Number.isFinite`, not `typeof === 'number'`: `NaN` and `Infinity` are both numbers, and a
  // `NaN` windowStart propagates all the way to the UI as a "NaN" countdown.
  if (
    typeof windowStart !== 'number' ||
    !Number.isFinite(windowStart) ||
    typeof repairsToday !== 'number' ||
    !Number.isFinite(repairsToday)
  ) {
    return null;
  }
  return {
    windowStart,
    // A hand-edited negative count would otherwise buy unlimited repairs.
    repairsToday: Math.max(0, repairsToday),
    plan: isPlan(parsed.plan) ? parsed.plan : 'free',
    ...(typeof parsed.licenseKey === 'string' && parsed.licenseKey !== ''
      ? { licenseKey: parsed.licenseKey }
      : {}),
    // A future timestamp would postpone the next check indefinitely — clamp it to now, so the
    // worst a tampered value can buy is one interval rather than forever.
    ...(typeof parsed.lastValidatedAt === 'number' && Number.isFinite(parsed.lastValidatedAt)
      ? { lastValidatedAt: Math.min(parsed.lastValidatedAt, Date.now()) }
      : {}),
  };
}

let _repo: ReturnType<typeof createRepairLimitRepository> | null = null;
let _referralRepo: ReturnType<typeof createReferralRepository> | null = null;
let state: Stored = freshFreeState();

function windowElapsed(): boolean {
  return Date.now() - state.windowStart >= REPAIR_WINDOW_MS;
}

function save(): void {
  if (_repo === null) return;
  try {
    _repo.save(state);
    console.error('[repair-limit] saved', {
      windowStart: state.windowStart,
      repairsToday: state.repairsToday,
      plan: state.plan,
    });
  } catch (error) {
    console.error('[repair-limit] could not persist state', { message: (error as Error).message });
  }
}

/** Best-effort, one-time read of the legacy JSON file — never trusted blind, and never fatal if it
 *  is missing, unreadable, or corrupt. Returns `null` for "nothing to migrate", not a throw. */
function migrateLegacyJsonFile(dir: string): Stored | null {
  const jsonFile = join(dir, 'repair-count.json');
  if (!existsSync(jsonFile)) return null;
  let migrated: Stored | null = null;
  try {
    const parsed = JSON.parse(readFileSync(jsonFile, 'utf8')) as Partial<Stored>;
    migrated = sanitize(parsed);
  } catch {
    // Corrupt or unreadable — nothing to migrate, but the file below is still renamed out of the
    // way so this path is not retried on every future launch.
  }
  try {
    renameSync(jsonFile, `${jsonFile}.migrated`);
  } catch (error) {
    console.error('[repair-limit] could not rename legacy JSON file after migration', {
      message: (error as Error).message,
    });
  }
  return migrated;
}

/** Called once at startup, before any handler can gate on the limit. */
export function initRepairLimit(driver: SqliteDriver, dir: string): void {
  _repo = createRepairLimitRepository(driver);
  // Same driver, one extra read per gate check — see `checkAndIncrementRepairLimit`'s bonus lookup.
  _referralRepo = createReferralRepository(driver);

  const existing = _repo.load();
  if (existing === null) {
    // Nothing in SQLite yet — this is either a brand-new install, or one still on the old JSON
    // file. Migrate it in if it's there; either way this runs at most once, since the JSON file is
    // renamed out of the way (or never existed) afterward.
    const migrated = migrateLegacyJsonFile(dir);
    state = migrated ?? freshFreeState();
    console.error('[repair-limit] init', {
      migratedFromJson: migrated !== null,
      windowStart: state.windowStart,
      windowAgeMs: Date.now() - state.windowStart,
      repairsToday: state.repairsToday,
      plan: state.plan,
    });
  } else {
    state = existing;
    console.error('[repair-limit] init', {
      migratedFromJson: false,
      windowStart: state.windowStart,
      windowAgeMs: Date.now() - state.windowStart,
      repairsToday: state.repairsToday,
      plan: state.plan,
    });
  }

  // A windowStart in the future (clock change, or a hand-edited file) would never elapse — clamp
  // it to now so the window can only ever be at most 3h long.
  if (state.windowStart > Date.now()) state = { ...state, windowStart: Date.now() };
  // Persisted, unlike the in-memory-only reset this used to do: a launch that rolls the window
  // must leave the new window on disk, or the next launch reloads the expired one.
  const rolled = rollWindowIfElapsed();
  // Write the fresh window immediately when there was nothing loaded (new install, or a JSON file
  // that failed to migrate).
  if (existing === null && !rolled) save();
}

export function getPlan(): Plan {
  return state.plan;
}

/** Set from `license:validate` on a successful Gumroad check — the only way to leave 'free'. */
export function setPlan(plan: Plan): void {
  state = { ...state, plan };
  save();
}

/** Records a successful activation or re-check: the key it was granted for, and when. */
export function recordValidation(plan: Plan, licenseKey: string): void {
  state = { ...state, plan, licenseKey, lastValidatedAt: Date.now() };
  save();
}

/** Drops the paid plan and the key behind it — a licence that failed verification must not be
 *  retried forever on a key Gumroad has already rejected. */
export function revokePlan(): void {
  const { windowStart, repairsToday } = state;
  state = { windowStart, repairsToday, plan: 'free' };
  save();
}

export function getLicenseKey(): string | null {
  return state.licenseKey ?? null;
}

export function isRevalidationDue(): boolean {
  if (state.plan === 'free' || state.licenseKey === undefined) return false;
  // Never validated (an upgrade from a build that did not record it) counts as due.
  return Date.now() - (state.lastValidatedAt ?? 0) >= REVALIDATION_INTERVAL_MS;
}

/**
 * Rolls the window over if it has elapsed — the ONE place that happens.
 *
 * Every reader used to inline `if (windowElapsed()) state = {…}` and only the timer bothered to
 * `save()`. So a rollover triggered by a read lived in memory and never reached disk: the stored
 * state kept the expired `windowStart` and the old count, and the next launch loaded them straight
 * back. That is a reset that visibly works until you restart the app, then silently un-works.
 */
function rollWindowIfElapsed(): boolean {
  if (!windowElapsed()) return false;
  console.error('[repair-limit] window elapsed — resetting count', {
    now: Date.now(),
    windowStart: state.windowStart,
    windowAgeMs: Date.now() - state.windowStart,
    repairWindowMs: REPAIR_WINDOW_MS,
    previousCount: state.repairsToday,
  });
  state = { ...state, windowStart: Date.now(), repairsToday: 0 };
  save();
  return true;
}

export function getRepairCount(): number {
  rollWindowIfElapsed();
  return state.repairsToday;
}

/** Rolls the window over if it has elapsed. Called on a timer so an app left open still resets. */
export function resetIfWindowElapsed(): void {
  rollWindowIfElapsed();
}

/**
 * When the current window rolls over, as an epoch ms — what the renderer counts down to.
 *
 * `windowStart` is read from storage and can be anything a hand-edited or truncated legacy file
 * contained, and `NaN + REPAIR_WINDOW_MS` is `NaN` — which reaches the UI as a "NaN" countdown
 * rather than an error. Repaired here at the source: a start that is not a finite number is
 * treated as "now".
 */
export function getWindowResetsAt(): number {
  if (!Number.isFinite(state.windowStart)) {
    console.error('[repair-limit] windowStart is not a finite number — repairing to now', {
      windowStart: state.windowStart,
    });
    state = { ...state, windowStart: Date.now() };
    save();
  }
  return state.windowStart + REPAIR_WINDOW_MS;
}

export interface RepairLimitCheck {
  readonly allowed: boolean;
  readonly plan: Plan;
  readonly used: number;
  readonly limit: number;
  /** One sentence for the user, present only when refused. */
  readonly message?: string;
}

/** The same check WITHOUT consuming an allowance — for a caller that wants to refuse early with a
 *  useful message before delegating to a path that will consume it itself (see mcp.handlers.ts). */
export function peekRepairLimit(): RepairLimitCheck {
  rollWindowIfElapsed();
  const { plan } = state;
  const limit = PLAN_LIMIT[plan];
  const used = state.repairsToday;
  if (used >= limit) {
    return { allowed: false, plan, used, limit, message: limitMessage(plan, limit) };
  }
  return { allowed: true, plan, used, limit };
}

function limitMessage(plan: Plan, limit: number): string {
  return (
    `You've used all ${String(limit)} repairs for this 3-hour window on the ${plan.toUpperCase()} plan. ` +
    'The window resets 3 hours after your first repair in it — or upgrade for a higher limit.'
  );
}

/**
 * The gate. Checks the limit and — when allowed — consumes one repair in the same call, so two
 * concurrent requests cannot both see the last remaining slot (main is single-threaded, so a
 * check-then-increment inside one synchronous function is genuinely atomic here).
 */
export function checkAndIncrementRepairLimit(): RepairLimitCheck {
  // Re-read from SQLite before deciding.
  //
  // The in-memory copy is only authoritative while this process is the sole writer, and it is not:
  // a `--mcp` instance runs the same module, and the row can be written underneath us. Without
  // this, an in-memory count that had drifted high kept refusing repairs the stored state no
  // longer justified — a paying user locked out by a number nothing on disk agreed with. Reading
  // first costs one small synchronous read per repair, against a call that is about to make a
  // network round trip to a model.
  if (_repo !== null) state = _repo.load() ?? state;
  // Rolled (and persisted) before the count is read, so a request arriving after the window
  // expired is measured against the new window rather than the old one's exhausted total.
  rollWindowIfElapsed();

  const { plan } = state;
  // Referral bonus (migration v11) widens the plan ceiling — it never replaces it, so a revoked
  // plan still falls back to the FREE limit plus whatever bonus this device earned.
  const bonusRepairs = _referralRepo?.getBonusRepairs() ?? 0;
  const limit = PLAN_LIMIT[plan] + bonusRepairs;
  const used = state.repairsToday;

  if (used >= limit) {
    return { allowed: false, plan, used, limit, message: limitMessage(plan, limit) };
  }

  state = { ...state, repairsToday: used + 1 };
  save();
  return { allowed: true, plan, used: state.repairsToday, limit };
}
