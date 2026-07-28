import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { discoverSamples, hashSources } from './runner.js';

/**
 * BUG-004 regression coverage. Eleven committed manifests once carried a `sourceHashes` fingerprint
 * recorded against a pre-edit draft of their fixture, then the fixture was tweaked (a shared
 * tsconfig.json template standardized across react/typescript samples; per-sample config.json
 * touch-ups) before the commit landed, without ever re-running `certify:record`. `certify:check`
 * then failed every one of those samples as fixture-drift even though the samples were never
 * actually corrupted — the manifest was simply stale from the moment it was committed.
 *
 * This test walks the REAL, committed samples/certification tree (not a synthetic tmpdir) and
 * asserts every recorded fingerprint matches the fixture bytes actually on disk. It would have
 * failed on the exact 11 stale manifests from day one of commit 126aa6e, instead of surfacing only
 * when someone happened to run the gate.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLES = join(here, '..', '..', '..', 'samples', 'certification');

describe('committed certification manifests — fingerprint integrity', () => {
  const samples = discoverSamples(SAMPLES);

  it('discovers a non-trivial number of samples (sanity check the tree resolved)', () => {
    expect(samples.length).toBeGreaterThan(10);
  });

  for (const { dir, sample } of samples) {
    if (sample.sourceHashes === undefined) continue;

    it(`${sample.language}/${sample.id}: recorded sourceHashes match the committed fixture bytes`, () => {
      const current = hashSources(dir);
      for (const [file, recorded] of Object.entries(sample.sourceHashes ?? {})) {
        expect(current[file], `${file} in ${sample.language}/${sample.id}`).toBe(recorded);
      }
    });
  }
});
