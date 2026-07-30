import { mkdirSync, readFileSync, writeFile, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPAIR_METRICS_LIMIT, RepairMetricSchema, type RepairMetric } from '@fixora/shared-types';

/**
 * The rolling store of anonymous repair metrics (developer diagnostics).
 *
 * Two properties matter more than anything else here, and both are structural rather than aspirational:
 *
 * **It can never slow a repair down.** `record()` does one array push, one trim, and schedules a
 * debounced write — it never awaits, never touches disk inline, and swallows its own failures. A
 * diagnostics feature that can fail a repair is worse than no diagnostics feature.
 *
 * **It can never store source code.** Every record is validated against `RepairMetricSchema`, which is
 * `.strict()` and has no field able to hold code. A caller that passes something richer is rejected at
 * the boundary rather than trusted, so the privacy guarantee holds even against a careless caller.
 */

/** How long to coalesce writes. Long enough that a burst of repairs costs one write, not twenty. */
const FLUSH_DEBOUNCE_MS = 2_000;

export interface MetricsStore {
  /** Fire-and-forget. Never throws, never blocks, never awaits. */
  record(metric: RepairMetric): void;
  /** Newest last. A copy, so a caller cannot mutate the ring. */
  all(): RepairMetric[];
  clear(): void;
  /**
   * Write synchronously, now. Used at shutdown and by tests — "flush" that returned before the bytes
   * landed would be a misleading name for the one call whose whole job is that they have.
   */
  flush(): void;
}

export function createMetricsStore(options: { dir: string; fileName?: string }): MetricsStore {
  const file = join(options.dir, options.fileName ?? 'repair-metrics.json');
  let metrics: RepairMetric[] = load(file);
  let timer: NodeJS.Timeout | null = null;

  function schedulePersist(): void {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      persist(file, metrics);
    }, FLUSH_DEBOUNCE_MS);
    // Do not hold the process open for a diagnostics write.
    timer.unref();
  }

  return {
    record(metric) {
      try {
        // Validated, not trusted. This is where the privacy guarantee is actually enforced: an
        // unknown key (a stray `prompt`, say) fails `.strict()` and the record is dropped entirely
        // rather than written with the extra field.
        const parsed = RepairMetricSchema.safeParse(metric);
        if (!parsed.success) {
          console.error('[metrics] rejected a malformed record', {
            issues: parsed.error.issues.map((i) => i.path.join('.')),
          });
          return;
        }
        metrics.push(parsed.data);
        // Roll off the oldest. Bounded by construction, so the file cannot grow without limit.
        if (metrics.length > REPAIR_METRICS_LIMIT) {
          metrics = metrics.slice(metrics.length - REPAIR_METRICS_LIMIT);
        }
        schedulePersist();
      } catch {
        // Diagnostics must never be able to fail the thing they observe.
      }
    },

    all: () => [...metrics],

    clear() {
      metrics = [];
      schedulePersist();
    },

    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      persistSync(file, metrics);
    },
  };
}

/** Read the stored ring, degrading to empty on anything unexpected — this is a cache, not a source. */
function load(file: string): RepairMetric[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(raw)) return [];
    // Per-record validation: one corrupt entry drops itself, not the whole history.
    const out: RepairMetric[] = [];
    for (const entry of raw) {
      const parsed = RepairMetricSchema.safeParse(entry);
      if (parsed.success) out.push(parsed.data);
    }
    return out.slice(-REPAIR_METRICS_LIMIT);
  } catch {
    return [];
  }
}

/** Synchronous, for shutdown: the process may not survive long enough for a callback to fire. */
function persistSync(file: string, metrics: readonly RepairMetric[]): void {
  try {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, JSON.stringify(metrics), 'utf8');
  } catch {
    // As below — diagnostics never surface an error.
  }
}

function persist(file: string, metrics: readonly RepairMetric[]): void {
  try {
    mkdirSync(join(file, '..'), { recursive: true });
    // Async and unawaited: the caller is a repair pipeline, and this is bookkeeping.
    writeFile(file, JSON.stringify(metrics), 'utf8', () => {
      // Errors are deliberately ignored — a diagnostics file that cannot be written is not an
      // error the user should ever see.
    });
  } catch {
    // As above.
  }
}
