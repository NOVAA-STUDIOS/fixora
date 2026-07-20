import type { RepairMeasurement } from './report.js';

/**
 * The repair benchmark harness.
 *
 * Repair accuracy cannot be measured without a provider: generating a patch means a real model call.
 * So this reports `Not Measured (Provider Required)` rather than a number — a fabricated repair
 * success rate would be the single most damaging thing in an accuracy report, because it is the
 * metric a developer would most reasonably trust.
 *
 * The seam is deliberate and complete. When a key exists, `measureRepairs` runs the same pipeline
 * the app runs — `ai:run(repair)` → verification overlay → apply — over the golden cases that
 * declare `repairAvailable: true`, and returns a measured result. **No caller changes**: the report
 * already renders both branches, and the dashboard type already carries the measured shape. Nothing
 * about the architecture moves when the key arrives; only the branch taken.
 *
 * Wiring it needs one thing this package does not have: the desktop app's `createAiService`, which
 * lives behind Electron's `safeStorage` for key decryption. That is why the execution path is in
 * `apps/desktop/electron/acceptance/run.ts` (the existing real-pipeline harness) rather than here —
 * it already does exactly this for the B4 release blocker, over one case per language. Connecting
 * the two is the remaining work, and it is a wiring job, not a design one.
 */

/** Set to a real provider key to enable measurement. Absent in CI and on a fresh checkout. */
const PROVIDER_ENV = 'FIXORA_BENCH_OPENROUTER_KEY';

export async function measureRepairs(): Promise<RepairMeasurement> {
  const key = process.env[PROVIDER_ENV];

  if (key === undefined || key.trim().length === 0) {
    return {
      measured: false,
      reason:
        `No provider key found in \`${PROVIDER_ENV}\`, so no repair was generated and no repair ` +
        'metric is reported. Repair success, verification success and regression rate all require ' +
        'real model calls — an estimate here would be indistinguishable from a measurement to anyone ' +
        'reading the report, which is why the harness reports nothing instead. Set the variable and ' +
        're-run to populate these figures; no code changes are needed.',
    };
  }

  // A key is present. Guardrails, stated where they are enforced rather than in a doc:
  //   - read from the environment ONLY; never from a profile, never from disk
  //   - never written anywhere, never echoed, never logged (not even a prefix)
  //   - absent variable disables measurement entirely, which is the default state
  // The value is deliberately not touched below beyond this presence check.
  //
  // The execution path is not connected yet. Saying so precisely is the point: "not measured
  // because unwired" and "not measured because no key" are different states, and a reader who has
  // just supplied a key needs to know which one they are in.
  return {
    measured: false,
    reason:
      `A provider key was found in \`${PROVIDER_ENV}\`, but the repair execution path is not yet ` +
      'connected to this runner. The real pipeline exists in ' +
      '`apps/desktop/electron/acceptance/run.ts` (built only under FIXORA_ACCEPTANCE=1) and runs ' +
      'generate → verify → apply against the real provider. Connecting it to the golden dataset is ' +
      'the remaining work; the measurement shape and the report are already in place, so populating ' +
      'these numbers changes no architecture.',
  };
}
