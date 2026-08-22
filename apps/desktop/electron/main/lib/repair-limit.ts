import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Plan } from '@fixora/shared-types';

/**
 * The repair limit, enforced in MAIN.
 *
 * It used to live only in the renderer (`license-store.ts`'s `canRepair`, read from
 * `localStorage`), which meant the paywall was a value the untrusted side owned: one line in
 * DevTools set `plan: 'pro'` permanently, and the MCP server — which never touches the renderer at
 * all — walked past it entirely. Both counter AND plan are main-owned here, on disk in `userData`,
 * and every repair path gates on `checkAndIncrementRepairLimit` before a provider is ever called.
 *
 * The renderer keeps its own copy for UX (showing the upgrade dialog before a doomed round trip);
 * this is the enforcement.
 */

/** Rolling window, not a calendar day: the count resets 3h after the FIRST repair in the window. */
export const REPAIR_WINDOW_MS = 3 * 60 * 60 * 1000;

export const PLAN_LIMIT: Record<Plan, number> = { free: 10, go: 50, pro: Infinity };

interface Stored {
  windowStart: number;
  repairsToday: number;
  plan: Plan;
}

function isPlan(value: unknown): value is Plan {
  return value === 'free' || value === 'go' || value === 'pro';
}

let file: string | null = null;
let state: Stored = { windowStart: Date.now(), repairsToday: 0, plan: 'free' };

function windowElapsed(): boolean {
  return Date.now() - state.windowStart >= REPAIR_WINDOW_MS;
}

function save(): void {
  if (file === null) return;
  try {
    // Atomic: a truncating in-place write that loses power mid-flush leaves corrupt JSON, which
    // `load` would treat as "no file" and silently reset the count to zero — i.e. corruption would
    // be rewarded with free repairs.
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), 'utf8');
    renameSync(tmp, file);
    console.error('[repair-limit] saved', {
      file,
      windowStart: state.windowStart,
      repairsToday: state.repairsToday,
      plan: state.plan,
    });
  } catch (error) {
    console.error('[repair-limit] could not persist state', { message: (error as Error).message });
  }
}

function load(): Stored {
  if (file === null) return { windowStart: Date.now(), repairsToday: 0, plan: 'free' };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Stored>;
    // `Number.isFinite`, not `typeof === 'number'`: `NaN` and `Infinity` are both numbers, and a
    // `NaN` windowStart propagates all the way to the UI as a "NaN" countdown.
    const { windowStart, repairsToday } = parsed;
    if (
      typeof windowStart === 'number' &&
      Number.isFinite(windowStart) &&
      typeof repairsToday === 'number' &&
      Number.isFinite(repairsToday)
    ) {
      return {
        windowStart,
        // A hand-edited negative count would otherwise buy unlimited repairs.
        repairsToday: Math.max(0, repairsToday),
        plan: isPlan(parsed.plan) ? parsed.plan : 'free',
      };
    }
  } catch {
    // No file yet, or a corrupt one — start at zero rather than crash.
  }
  return { windowStart: Date.now(), repairsToday: 0, plan: 'free' };
}

/** Called once at startup, before any handler can gate on the limit. */
export function initRepairLimit(dir: string): void {
  file = join(dir, 'repair-count.json');
  const hadFile = existsSync(file);
  state = load();
  console.error('[repair-limit] init', {
    file,
    hadFile,
    windowStart: state.windowStart,
    windowAgeMs: Date.now() - state.windowStart,
    repairsToday: state.repairsToday,
    plan: state.plan,
  });
  // A windowStart in the future (clock change, or a hand-edited file) would never elapse — clamp
  // it to now so the window can only ever be at most 3h long.
  if (state.windowStart > Date.now()) state = { ...state, windowStart: Date.now() };
  // Persisted, unlike the in-memory-only reset this used to do: a launch that rolls the window
  // must leave the new window on disk, or the next launch reloads the expired one.
  const rolled = rollWindowIfElapsed();
  // Write the fresh window immediately when there was no file to load.
  //
  // `save()` used to happen only when a repair was CONSUMED, so a user who had not yet repaired
  // anything had no file — and every launch re-derived `windowStart: Date.now()`. The countdown
  // therefore restarted at a full 3h on each start and never advanced, which looks exactly like a
  // window that is not being tracked at all. Persisting here anchors the window to the first
  // launch that observed it, not to the most recent one.
  if (!hadFile && !rolled) save();
}

export function getPlan(): Plan {
  return state.plan;
}

/** Set from `license:validate` on a successful Gumroad check — the only way to leave 'free'. */
export function setPlan(plan: Plan): void {
  state = { ...state, plan };
  save();
}

/**
 * Rolls the window over if it has elapsed — the ONE place that happens.
 *
 * Every reader used to inline `if (windowElapsed()) state = {…}` and only the timer bothered to
 * `save()`. So a rollover triggered by a read lived in memory and never reached disk: the file kept
 * the expired `windowStart` and the old count, and the next launch loaded them straight back. That
 * is a reset that visibly works until you restart the app, then silently un-works.
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
 * `windowStart` is read off disk and can be anything a hand-edited or truncated file contains, and
 * `NaN + REPAIR_WINDOW_MS` is `NaN` — which reaches the UI as a "NaN" countdown rather than an
 * error. Repaired here at the source: a start that is not a finite number is treated as "now".
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
  // Re-read from disk before deciding.
  //
  // The in-memory copy is only authoritative while this process is the sole writer, and it is not:
  // a `--mcp` instance runs the same module, and the file can be deleted or edited underneath us.
  // Without this, an in-memory count that had drifted high kept refusing repairs the file no longer
  // justified — a paying user locked out by a number nothing on disk agreed with. Reading first
  // costs one small synchronous read per repair, against a call that is about to make a network
  // round trip to a model.
  if (file !== null) state = load();
  // Rolled (and persisted) before the count is read, so a request arriving after the window
  // expired is measured against the new window rather than the old one's exhausted total.
  rollWindowIfElapsed();

  const { plan } = state;
  const limit = PLAN_LIMIT[plan];
  const used = state.repairsToday;

  if (used >= limit) {
    return { allowed: false, plan, used, limit, message: limitMessage(plan, limit) };
  }

  state = { ...state, repairsToday: used + 1 };
  save();
  return { allowed: true, plan, used: state.repairsToday, limit };
}
