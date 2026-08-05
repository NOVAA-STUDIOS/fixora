import { describe, expect, it } from 'vitest';

import type { Finding } from './analysis.js';
import {
  categoryRank,
  classifyFinding,
  countByCategory,
  countByExtension,
  FINDING_CATEGORY_ORDER,
} from './finding-category.js';

/**
 * Classification is a PRESENTATION layer over `repairStateFor`, and these pin the property that
 * makes that safe: repairability is decided first, and no classification rule can take Repair away
 * from a finding the engine can actually fix. The inverse is pinned too — a configuration or
 * unsupported diagnostic must never be presented as repairable.
 */
function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    source: 'eslint',
    ruleId: 'no-unused-vars',
    severity: 'error',
    category: 'correctness',
    location: { file: 'src/a.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    message: 'x',
    evidence: { snippet: '', relatedLocations: [], toolOutput: null },
    fixable: false,
    repair: 'ai-required',
    confidence: 1,
    ...over,
  };
}

describe('classifyFinding — Repairable', () => {
  it('classifies a deterministic autofix as repairable, and says no model is needed', () => {
    const c = classifyFinding(finding({ repair: 'safe-auto' }));
    expect(c.category).toBe('repairable');
    expect(c.reason).toMatch(/no model needed/i);
  });

  it('classifies an ai-required finding as repairable', () => {
    expect(classifyFinding(finding({ repair: 'ai-required' })).category).toBe('repairable');
  });

  /** Requirement 6, as a test: classification must never reduce repair coverage. */
  it('an INFO-severity finding that is repairable stays Repairable, not Information', () => {
    const c = classifyFinding(finding({ severity: 'info', repair: 'safe-auto' }));
    expect(c.category).toBe('repairable');
  });
});

describe('classifyFinding — Configuration', () => {
  const missingTypes = finding({
    source: 'tsc',
    ruleId: 'TS2591',
    message: "Cannot find name 'crypto'. Do you need to install type definitions for node?",
    location: { file: 'auth.js', startLine: 3, startCol: 1, endLine: 3, endCol: 1 },
  });

  it('classifies missing Node typings as Configuration, never Repairable', () => {
    const c = classifyFinding(missingTypes);
    expect(c.category).toBe('configuration');
    expect(c.title).toBe('Configuration Issue');
  });

  it('carries the exact command, not a generic instruction', () => {
    const c = classifyFinding(missingTypes);
    expect(c.suggestedFix).toContain('npm install --save-dev @types/node');
    expect(c.nextStep).toMatch(/re-run analysis/i);
  });

  it('classifies a missing package as Configuration', () => {
    const c = classifyFinding(
      finding({
        source: 'tsc',
        ruleId: 'TS2307',
        message: "Cannot find module 'lodash' or its corresponding type declarations.",
      }),
    );
    expect(c.category).toBe('configuration');
    expect(c.suggestedFix).toBe('npm install lodash');
  });

  /** The relative-path guard: a wrong import path is a code defect, not a missing dependency. */
  it('does NOT classify a relative-import typo as Configuration', () => {
    const c = classifyFinding(
      finding({
        source: 'tsc',
        ruleId: 'TS2307',
        message: "Cannot find module './utils/helper' or its corresponding type declarations.",
      }),
    );
    expect(c.category).toBe('repairable');
  });
});

describe('classifyFinding — Manual Review', () => {
  it('classifies a manual-only rule as Manual Review and explains the ambiguity', () => {
    const c = classifyFinding(finding({ repair: 'manual' }));
    expect(c.category).toBe('manual-review');
    expect(c.title).toBe('Manual Review');
    expect(c.reason).toMatch(/more than one valid repair/i);
    expect(c.nextStep).toBeDefined();
  });

  it('classifies an unsupported file type as Manual Review, with the engine-limit reason', () => {
    const c = classifyFinding(
      finding({
        location: { file: 'notes.md', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      }),
    );
    expect(c.category).toBe('manual-review');
    expect(c.title).toBe('Unsupported');
    expect(c.reason).toMatch(/does not support this diagnostic/i);
  });

  it('an unsupported file type is unsupported even when the rule would be repairable', () => {
    const c = classifyFinding(
      finding({
        repair: 'safe-auto',
        location: { file: 'notes.md', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      }),
    );
    expect(c.title).toBe('Unsupported');
  });
});

describe('classifyFinding — Information', () => {
  it('classifies a non-repairable info finding as Information', () => {
    const c = classifyFinding(finding({ severity: 'info', repair: 'manual' }));
    expect(c.category).toBe('information');
    expect(c.nextStep).toMatch(/no action required/i);
  });
});

describe('every classification is specific', () => {
  const cases: Finding[] = [
    finding({ repair: 'safe-auto' }),
    finding({ repair: 'manual' }),
    finding({ severity: 'info', repair: 'manual' }),
    finding({ source: 'tsc', ruleId: 'TS2591', message: 'install type definitions for node' }),
    finding({ location: { file: 'x.md', startLine: 1, startCol: 1, endLine: 1, endCol: 1 } }),
  ];

  it('never returns a generic or empty reason', () => {
    for (const f of cases) {
      const c = classifyFinding(f);
      expect(c.reason.length).toBeGreaterThan(30);
      expect(c.reason.toLowerCase()).not.toContain('repair disabled');
      expect(c.reason.toLowerCase()).not.toContain('something went wrong');
      expect(c.title.length).toBeGreaterThan(0);
    }
  });

  it('every non-repairable category tells the developer what to do next', () => {
    for (const f of cases) {
      const c = classifyFinding(f);
      if (c.category === 'repairable') continue;
      expect(c.nextStep, c.title).toBeDefined();
    }
  });
});

describe('grouping helpers', () => {
  it('counts every finding into exactly one category', () => {
    const all = [
      finding({ id: 'a', repair: 'safe-auto' }),
      finding({ id: 'b', repair: 'manual' }),
      finding({ id: 'c', severity: 'info', repair: 'manual' }),
      finding({ id: 'd', source: 'tsc', ruleId: 'TS2591', message: 'install type definitions for node' }),
    ];
    const counts = countByCategory(all);
    expect(counts.repairable).toBe(1);
    expect(counts['manual-review']).toBe(1);
    expect(counts.information).toBe(1);
    expect(counts.configuration).toBe(1);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(all.length);
  });

  it('ranks categories in display order — actionable first', () => {
    expect(FINDING_CATEGORY_ORDER[0]).toBe('repairable');
    expect(FINDING_CATEGORY_ORDER.at(-1)).toBe('information');
    expect(categoryRank(finding({ repair: 'safe-auto' }))).toBeLessThan(
      categoryRank(finding({ severity: 'info', repair: 'manual' })),
    );
  });
});

/**
 * The Problems header's file-type breakdown.
 *
 * It answers "which languages are these problems in", which is why the last dot segment wins and a
 * test file counts as its language rather than as a type of its own.
 */
function at(file: string): Finding {
  return finding({ location: { file, startLine: 1, startCol: 1, endLine: 1, endCol: 1 } });
}

describe('countByExtension', () => {
  it('groups by extension, most problems first', () => {
    expect(
      countByExtension([at('a.ts'), at('b.css'), at('c.ts'), at('d.ts'), at('e.css')]),
    ).toEqual([
      { extension: 'ts', count: 3 },
      { extension: 'css', count: 2 },
    ]);
  });

  it('omits types with no problems — a clean workspace shows nothing, not a row of zeroes', () => {
    expect(countByExtension([])).toEqual([]);
    expect(countByExtension([at('only.py')])).toEqual([{ extension: 'py', count: 1 }]);
  });

  it('breaks ties alphabetically, so equal types do not swap places between runs', () => {
    expect(countByExtension([at('a.ts'), at('b.css'), at('c.py')])).toEqual([
      { extension: 'css', count: 1 },
      { extension: 'py', count: 1 },
      { extension: 'ts', count: 1 },
    ]);
  });

  it('counts a multi-dot file as its LAST segment — a test file is still TypeScript', () => {
    expect(countByExtension([at('src/x.test.ts'), at('src/y.ts')])).toEqual([
      { extension: 'ts', count: 2 },
    ]);
  });

  it('normalises case, so .TS and .ts are one type', () => {
    expect(countByExtension([at('A.TS'), at('b.ts')])).toEqual([{ extension: 'ts', count: 2 }]);
  });

  it('treats a dotfile as having no extension, despite the dot', () => {
    // `.gitignore` is a name, not an extension — reporting a `gitignore` file type would be wrong.
    expect(countByExtension([at('.gitignore')])).toEqual([{ extension: '?', count: 1 }]);
  });

  it('handles a file with no extension and a trailing dot', () => {
    expect(countByExtension([at('Makefile'), at('weird.')])).toEqual([{ extension: '?', count: 2 }]);
  });

  it('reads the extension from the basename, not from a dotted directory', () => {
    // `src/v1.2/handler` has a dot in the PATH but none in the file name.
    expect(countByExtension([at('src/v1.2/handler')])).toEqual([{ extension: '?', count: 1 }]);
  });

  it('handles Windows separators, which is what the analyzer emits on win32', () => {
    expect(countByExtension([at('src\\deep\\a.py')])).toEqual([{ extension: 'py', count: 1 }]);
  });
});
