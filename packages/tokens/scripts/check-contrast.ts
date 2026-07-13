import { auditAllThemes, type ContrastResult } from '../src/requirements.js';

/**
 * The contrast gate (M0 acceptance criterion: "a contrast violation in a token file fails the
 * build"). It is deliberately a *build* gate rather than a lint suggestion, because
 * accessibility that is announced once and never re-checked decays within a quarter
 * (Design Review §6.3).
 */

const results = auditAllThemes();
const failures = results.filter((r) => !r.passed);

function format(r: ContrastResult): string {
  const verdict = r.passed ? 'PASS' : 'FAIL';
  const ratio = `${r.ratio.toFixed(2).padStart(5)}:1`;
  const required = `(needs ${r.minRatio.toFixed(1)}:1)`;
  return `  ${verdict}  ${ratio} ${required.padEnd(15)} [${r.theme}] ${r.id}  ${r.fgHex} on ${r.bgHex}`;
}

if (process.argv.includes('--verbose') || failures.length > 0) {
  for (const r of results) {
    if (failures.length > 0 && r.passed) continue;
    console.warn(format(r));
  }
}

if (failures.length > 0) {
  console.error(
    `\n✗ Contrast gate FAILED: ${String(failures.length)} of ${String(results.length)} required pairs are below WCAG 2.2 AA.\n`,
  );
  for (const f of failures) {
    console.error(`  ${f.id} [${f.theme}]`);
    console.error(
      `    ${f.fgHex} on ${f.bgHex} — ${f.ratio.toFixed(2)}:1, needs ${String(f.minRatio)}:1`,
    );
    console.error(`    why this pair is checked: ${f.why}\n`);
  }
  console.error(
    'Next step: adjust the offending value in packages/tokens/src/primitives.ts and re-run\n' +
      '`pnpm --filter @fixora/tokens gate:contrast`. Do not weaken requirements.ts to make this\n' +
      'pass — the requirement is the product decision; the hex is not.\n',
  );
  process.exit(1);
}

console.warn(
  `✓ Contrast gate passed: ${String(results.length)} required pairs, both themes, WCAG 2.2 AA.`,
);
