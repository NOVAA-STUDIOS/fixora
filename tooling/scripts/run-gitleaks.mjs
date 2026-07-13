import { spawnSync } from 'node:child_process';

/**
 * gitleaks is a Go binary, not an npm package, so this wrapper is the difference between
 * "the gate ran" and "the gate was absent and nobody noticed" — which is the failure mode
 * that matters, because a gate that silently skips is worse than no gate: it produces a green
 * build that means nothing.
 *
 * In CI its absence is a hard failure. Locally it is also a hard failure, with an install
 * line — Repo §4 is explicit that a gate which can be skipped is not a gate.
 */

const probe = spawnSync('gitleaks', ['version'], { encoding: 'utf8', shell: true });

if (probe.status !== 0) {
  console.error(
    '\n✗ gitleaks is not installed, so the secret-scanning gate cannot run.\n\n' +
      '  Install it:\n' +
      '    winget install gitleaks          (Windows)\n' +
      '    brew install gitleaks            (macOS)\n' +
      '    https://github.com/gitleaks/gitleaks/releases\n\n' +
      '  This gate is not optional (Repo §4). A tool whose entire thesis is "we will not leak\n' +
      '  your secrets" does not ship without a secret scanner in its own pipeline.\n',
  );
  process.exit(1);
}

const result = spawnSync(
  'gitleaks',
  ['detect', '--source', '.', '--redact', '--no-banner', '--exit-code', '1'],
  { stdio: 'inherit', shell: true },
);

if (result.status !== 0) {
  console.error(
    '\n✗ gitleaks found a secret. It has been redacted in the output above.\n' +
      '  Rotate it first, then remove it from history. A secret in a commit is leaked even\n' +
      '  after you delete the line.\n',
  );
  process.exit(1);
}

console.warn('✓ gitleaks: no secrets found.');
