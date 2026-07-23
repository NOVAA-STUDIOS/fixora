import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { collectFiles, discoverProjects } from './projects.js';

/**
 * Discovery is the harness's front door: if it misses a project or picks up the manifest as source,
 * every downstream number is computed over the wrong set. These tests pin discovery against the real
 * corpus that ships with the harness.
 */

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), '..', 'projects');

describe('discoverProjects (real corpus)', () => {
  const projects = discoverProjects(CORPUS);

  it('finds every language the harness claims to validate', () => {
    const langs = new Set(projects.map((p) => p.manifest.language));
    for (const lang of ['javascript', 'typescript', 'react', 'python', 'json', 'css', 'html']) {
      expect(langs).toContain(lang);
    }
  });

  it('gives every project a name, a compile kind, and a requiresTools list', () => {
    expect(projects.length).toBeGreaterThanOrEqual(7);
    for (const p of projects) {
      expect(p.manifest.name).toMatch(/\S/);
      expect(['node-check', 'tsc', 'py-compile', 'json-parse', 'none']).toContain(
        p.manifest.compile,
      );
      expect(Array.isArray(p.manifest.requiresTools)).toBe(true);
    }
  });
});

describe('collectFiles', () => {
  const py = discoverProjects(CORPUS).find((p) => p.manifest.name === 'python-text-metrics');

  it('collects analyzable source and never the manifest itself', () => {
    expect(py).toBeDefined();
    const files = collectFiles(py!.dir);
    expect(files.some((f) => f.file.endsWith('.py'))).toBe(true);
    expect(files.some((f) => f.file.endsWith('validation.json'))).toBe(false);
    // Every collected file resolved to a language the engine understands.
    for (const f of files) expect(f.language).not.toBeNull();
  });
});
