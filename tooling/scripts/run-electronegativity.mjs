import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';

/**
 * Electronegativity scans for Electron misconfiguration. "Configuration drifts; scanners don't
 * get tired" (Security §2) — this is the gate that catches the day someone flips
 * `sandbox: false` to make a native module work, and the PR is approved because the feature
 * works.
 *
 * SARIF rather than CSV, because SARIF is what GitHub code scanning ingests: the same artifact
 * that fails the build locally can annotate the PR without a second parser to keep in step.
 */

const TARGET = 'apps/desktop';
const REPORT = 'electronegativity-report.sarif';

/**
 * SARIF levels, mapped to our policy. `error` and `warning` block: every check
 * Electronegativity is confident about corresponds to something Security §2 lists as
 * mandatory. `note` is informational — it is mostly "you don't use this API", which is true
 * and is the point.
 */
const BLOCKING_LEVELS = new Set(['error', 'warning']);

rmSync(REPORT, { force: true });

const run = spawnSync(
  'npx',
  ['--no-install', 'electronegativity', '-i', TARGET, '-o', REPORT, '-r'],
  {
    stdio: 'inherit',
    shell: true,
  },
);

if (run.error) {
  console.error('✗ could not run electronegativity:', run.error.message);
  process.exit(1);
}

let sarif;
try {
  sarif = JSON.parse(readFileSync(REPORT, 'utf8'));
} catch (error) {
  console.error(
    `✗ electronegativity produced no parseable SARIF at ${REPORT}: ${error.message}\n` +
      '  The scan did not run. Do not treat this as a pass.',
  );
  process.exit(1);
}

const results = sarif.runs?.flatMap((r) => r.results ?? []) ?? [];

const describe = (r) => {
  const loc = r.locations?.[0]?.physicalLocation;
  const file = loc?.artifactLocation?.uri ?? '?';
  const line = loc?.region?.startLine ?? '?';
  return `${r.ruleId ?? 'unknown'} — ${file}:${line}`;
};

const blocking = results.filter((r) => BLOCKING_LEVELS.has(r.level));
const informational = results.filter((r) => !BLOCKING_LEVELS.has(r.level));

for (const r of informational) {
  console.warn(`  [note] ${describe(r)}`);
}

if (blocking.length > 0) {
  console.error(`\n✗ Electronegativity found ${blocking.length} blocking issue(s):\n`);
  for (const r of blocking) {
    console.error(`  [${r.level}] ${describe(r)}`);
    console.error(`    ${r.message?.text ?? ''}\n`);
  }
  console.error(
    'Every one of these is listed as mandatory in Security §2. If you believe a finding is\n' +
      'wrong, that belongs in an ADR, not in a suppression comment.\n',
  );
  process.exit(1);
}

console.warn(
  `✓ Electronegativity: no blocking misconfiguration (${informational.length} informational).`,
);
