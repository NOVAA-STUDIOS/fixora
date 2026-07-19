// Vendors the official Ruff binary for tier 2 Python analysis.
//
// Build time only. Fixora never downloads an executable at runtime (Engineering Spec §10), so this
// runs once, on a developer or CI machine, and the verified binary is what ships.
//
// The security shape, in order, and the order is the point:
//
//   1. Download the artifact from Astral's official GitHub release, at a PINNED version.
//   2. Compute its SHA256 and compare against a checksum COMMITTED IN THIS FILE.
//   3. Only if they match, unpack.
//
// Verifying before unpacking matters because unpacking is the first moment untrusted bytes get
// interpreted — a zip parser handed a malicious archive is already executing attacker-influenced
// code paths, and path traversal in an archive can write outside the destination.
//
// On the limits of this, honestly: the checksum is fetched from the same host as the artifact, so on
// the very first pin it is trust-on-first-use, not independent attestation. What committing it buys
// is that every subsequent build detects any change to that artifact — a re-tagged release, a
// compromised CDN object, a corrupted download. To rotate the version you must consciously replace
// the checksum, which is exactly the review checkpoint we want. Do NOT "fix" a mismatch by pasting in
// the new hash without establishing where the new bytes came from.
//
// NEVER take Ruff from npm: `@astral-sh/ruff` does not exist there, and a package named plain `ruff`
// exists at a version inconsistent with upstream (Engineering Spec §10).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/** Pinned. Changing this REQUIRES changing the matching checksum below. */
const RUFF_VERSION = '0.15.22';

/**
 * SHA256 of each official release archive, as published by Astral at
 * https://github.com/astral-sh/ruff/releases/download/<version>/<artifact>.sha256
 *
 * Recorded 2026-07-19 for 0.15.22.
 */
const ARTIFACTS = {
  'win32-x64': {
    name: `ruff-x86_64-pc-windows-msvc.zip`,
    sha256: '6e5419593984941405e9add902e89c6ea4af87d97919ac5ef82e1bc4e43bbd8d',
    binary: 'ruff.exe',
  },
  'win32-arm64': {
    name: `ruff-aarch64-pc-windows-msvc.zip`,
    sha256: '76a57fe257602c386499437071a16abb1ee51fff68c8b4c28b0bf8a0d9f7aa34',
    binary: 'ruff.exe',
  },
};

const here = dirname(fileURLToPath(import.meta.url));
const vendorDir = join(here, '..', 'vendor', 'ruff');

function fail(message) {
  console.error(`vendor-ruff: ${message}`);
  process.exit(1);
}

async function main() {
  const platformKey = `${process.platform}-${process.arch}`;
  const artifact = ARTIFACTS[platformKey];
  if (artifact === undefined) {
    // Not a silent skip: a build that quietly produces no Python support is the failure mode this
    // whole tier exists to prevent.
    fail(
      `no pinned Ruff artifact for ${platformKey}. Add it to ARTIFACTS with its official checksum.`,
    );
  }

  const target = join(vendorDir, artifact.binary);
  if (existsSync(target)) {
    console.log(`vendor-ruff: ${target} already present (${RUFF_VERSION}). Nothing to do.`);
    return;
  }

  const url = `https://github.com/astral-sh/ruff/releases/download/${RUFF_VERSION}/${artifact.name}`;
  console.log(`vendor-ruff: downloading ${url}`);

  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    fail(`download failed: HTTP ${String(response.status)}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());

  // --- the gate. Nothing below this line runs on unverified bytes. ---
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== artifact.sha256) {
    fail(
      `CHECKSUM MISMATCH for ${artifact.name}\n` +
        `  expected ${artifact.sha256}\n` +
        `  actual   ${actual}\n` +
        `The downloaded bytes are not the pinned release. Nothing was unpacked. Do not proceed by\n` +
        `updating the expected hash unless you have established where the new bytes came from.`,
    );
  }
  console.log(`vendor-ruff: sha256 verified (${actual})`);

  mkdirSync(vendorDir, { recursive: true });
  const archivePath = join(vendorDir, artifact.name);
  writeFileSync(archivePath, bytes);

  try {
    // Extract with the platform's own tool rather than adding an archive library to the dependency
    // tree — one less package with filesystem write access in a security-sensitive path.
    if (process.platform === 'win32') {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${vendorDir}' -Force`,
        ],
        { stdio: 'inherit' },
      );
    } else {
      execFileSync('tar', ['-xzf', archivePath, '-C', vendorDir], { stdio: 'inherit' });
    }
  } finally {
    rmSync(archivePath, { force: true });
  }

  if (!existsSync(target)) {
    fail(`unpacked archive did not contain ${artifact.binary} at ${target}`);
  }

  // Record what was vendored, so the shipped tree can be audited without re-downloading.
  writeFileSync(
    join(vendorDir, 'PROVENANCE.json'),
    `${JSON.stringify(
      { tool: 'ruff', version: RUFF_VERSION, artifact: artifact.name, sha256: artifact.sha256, source: url, vendoredAt: new Date().toISOString() },
      null,
      2,
    )}\n`,
  );

  const version = execFileSync(target, ['--version'], { encoding: 'utf8' }).trim();
  console.log(`vendor-ruff: vendored ${version} -> ${target}`);
  if (!version.includes(RUFF_VERSION)) {
    fail(`vendored binary reports "${version}", expected ${RUFF_VERSION}`);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
