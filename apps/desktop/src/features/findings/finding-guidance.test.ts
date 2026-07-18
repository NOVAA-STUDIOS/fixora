import type { Finding, FindingSource } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { CATEGORY_GUIDANCE, docsLinkFor } from './finding-guidance.js';

/**
 * The details panel's docs link and the main process's `openExternal` allowlist are two files that
 * have to agree: a link this module emits is opened through that guard, and a host the guard does
 * not know is *refused* — the user clicks and nothing happens. That is a silent failure, so it is
 * pinned here rather than discovered in the field. Adding a source with a new docs host must fail
 * this test until the host is added to the guard deliberately (Security §2).
 */

// Kept in sync with ALLOWED_EXTERNAL_HOSTS in electron/main/security/navigation-guard.ts.
const ALLOWED_HOSTS = [
  'fixora.dev',
  'github.com',
  'eslint.org',
  'docs.astral.sh',
  'mypy.readthedocs.io',
  'pkg.go.dev',
  'semgrep.dev',
];

const ALL_SOURCES: FindingSource[] = [
  'eslint',
  'tsc',
  'ruff',
  'mypy',
  'go-vet',
  'semgrep',
  'complexity',
  'ai',
];

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    source: 'eslint',
    ruleId: 'no-eval',
    severity: 'error',
    category: 'security',
    location: { file: 'src/a.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 2 },
    message: 'eval is evil',
    evidence: { snippet: 'eval(x)', relatedLocations: [], toolOutput: null },
    fixable: false,
    confidence: 1,
    ...over,
  };
}

describe('docsLinkFor', () => {
  it('only ever emits https URLs on hosts the navigation guard allows', () => {
    for (const source of ALL_SOURCES) {
      const link = docsLinkFor(finding({ source, ruleId: 'some.rule-id' }));
      if (link === null) continue;
      const url = new URL(link.href);
      expect(url.protocol).toBe('https:');
      expect(ALLOWED_HOSTS).toContain(url.hostname);
    }
  });

  it('deep-links a core ESLint rule', () => {
    expect(docsLinkFor(finding({ ruleId: 'no-eval' }))?.href).toBe(
      'https://eslint.org/docs/latest/rules/no-eval',
    );
  });

  it('stays silent for an ESLint plugin rule rather than guessing a docs host', () => {
    expect(docsLinkFor(finding({ ruleId: '@typescript-eslint/no-explicit-any' }))).toBeNull();
  });

  it('cannot be steered off-host by a hostile rule id', () => {
    const link = docsLinkFor(finding({ ruleId: '../../../evil.example.com' }));
    // Either refused outright, or kept on eslint.org with the id escaped into a single segment.
    if (link !== null) expect(new URL(link.href).hostname).toBe('eslint.org');
  });

  it('has no docs link for sources without a stable per-rule page', () => {
    expect(docsLinkFor(finding({ source: 'tsc', ruleId: 'TS2304' }))).toBeNull();
    expect(docsLinkFor(finding({ source: 'complexity', ruleId: 'cyclomatic' }))).toBeNull();
  });
});

describe('CATEGORY_GUIDANCE', () => {
  it('covers every category with non-empty prose', () => {
    for (const g of Object.values(CATEGORY_GUIDANCE)) {
      expect(g.what.length).toBeGreaterThan(20);
      expect(g.ifIgnored.length).toBeGreaterThan(20);
      expect(g.fix.length).toBeGreaterThan(20);
    }
  });
});
