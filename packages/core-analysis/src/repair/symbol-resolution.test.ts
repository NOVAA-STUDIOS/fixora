import type { Location } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import {
  buildRenameAutofix,
  decide,
  editDistance,
  extractUndefinedName,
  importedNames,
  isUndefinedNameRule,
  locateIdentifier,
  rankCandidates,
  resolveUndefinedName,
  scoreCandidate,
  tokenize,
  type CandidateSources,
  type SymbolCandidate,
} from './symbol-resolution.js';

/**
 * Context-aware symbol resolution for TS2304 / F821.
 *
 * These rules were once refused outright as `manual`. The safety argument for that refusal — that a
 * confidently-applied WRONG identifier is worse than no fix, because a wrong-but-defined name compiles
 * clean and the verifier cannot catch it — is exactly the argument these tests exist to protect. So
 * they pin the accept path AND, at greater length, every refuse path: ambiguity, weak matches, short
 * identifiers, and a source that does not read as expected at the offset.
 */

function at(line: number, col: number, file = 'src/a.ts'): Location {
  return { file, startLine: line, startCol: col, endLine: line, endCol: col };
}

function candidate(name: string, origin: SymbolCandidate['origin'] = 'same-file'): SymbolCandidate {
  return { name, origin, location: at(1, 1) };
}

function sources(over: Partial<CandidateSources> = {}): CandidateSources {
  return { sameFile: () => [], imports: () => [], project: () => [], ...over };
}

describe('extractUndefinedName', () => {
  it("reads tsc's TS2304 phrasing", () => {
    expect(extractUndefinedName('TS2304', "Cannot find name 'useSate'.")).toBe('useSate');
  });

  it("reads Ruff's F821 phrasing, which quotes with a backtick", () => {
    expect(extractUndefinedName('F821', 'Undefined name `reuslt`')).toBe('reuslt');
  });

  it('reads the "X is not defined" phrasing', () => {
    expect(extractUndefinedName('F821', "'my_var' is not defined")).toBe('my_var');
  });

  it('returns null for an unfamiliar message rather than resolving against a mis-parse', () => {
    expect(extractUndefinedName('TS2304', 'Something entirely different happened.')).toBeNull();
  });

  it('applies to no other rule, however similar the message looks', () => {
    expect(extractUndefinedName('TS2322', "Cannot find name 'x'.")).toBeNull();
    expect(isUndefinedNameRule('TS2304')).toBe(true);
    expect(isUndefinedNameRule('F821')).toBe(true);
    expect(isUndefinedNameRule('no-unused-vars')).toBe(false);
  });
});

describe('editDistance', () => {
  it('measures single-character typos', () => {
    expect(editDistance('useSate', 'useState')).toBe(1); // insertion
    expect(editDistance('lenght', 'length')).toBe(2); // transposition, as two edits
    expect(editDistance('usestate', 'useState')).toBe(1); // case substitution
    expect(editDistance('user', 'user')).toBe(0);
  });

  it('caps rather than computing a large distance nobody needs', () => {
    expect(editDistance('completelyDifferent', 'nothingAlike', 2)).toBeGreaterThan(2);
  });
});

describe('tokenize', () => {
  it('splits camelCase, snake_case and SCREAMING_SNAKE alike', () => {
    expect(tokenize('getUserName')).toEqual(['get', 'user', 'name']);
    expect(tokenize('get_user_name')).toEqual(['get', 'user', 'name']);
    expect(tokenize('MAX_RETRY_COUNT')).toEqual(['max', 'retry', 'count']);
  });
});

describe('scoreCandidate', () => {
  it('scores a one-character typo on a long name highly', () => {
    expect(scoreCandidate('useSate', 'useState').confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('scores a case-only difference higher still — it is never a different variable', () => {
    const caseOnly = scoreCandidate('usestate', 'useState').confidence;
    expect(caseOnly).toBeGreaterThan(scoreCandidate('useSate', 'useState').confidence);
  });

  it('rewards an identical token set in a different convention', () => {
    expect(scoreCandidate('getusername', 'getUserName').confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('scores a short, unrelated name low even at distance 1', () => {
    // `foo` → `for` is one edit but a completely different token. This is the case that must NOT
    // become an automatic repair.
    expect(scoreCandidate('foo', 'for').confidence).toBeLessThan(0.7);
  });
});

describe('rankCandidates', () => {
  it('drops names too far away to be a typo', () => {
    const ranked = rankCandidates('useState', [
      candidate('completelyUnrelated'),
      candidate('render'),
    ]);
    expect(ranked).toEqual([]);
  });

  it('never offers the undefined name itself as its own fix', () => {
    expect(rankCandidates('useState', [candidate('useState')])).toEqual([]);
  });

  it('orders by confidence, then by nearest scope', () => {
    const ranked = rankCandidates('useSate', [
      candidate('useState', 'project'),
      candidate('useState', 'same-file'),
    ]);
    expect(ranked[0]?.origin).toBe('same-file');
  });
});

// ─── The seven required scenarios ────────────────────────────────────────────────────────────────

describe('scenario: same-file typo repair', () => {
  it('resolves to the one close symbol declared in the same file', () => {
    const resolution = resolveUndefinedName(
      { ruleId: 'TS2304', message: "Cannot find name 'calculateTotl'." },
      sources({ sameFile: () => [candidate('calculateTotal')] }),
    );
    expect(resolution.outcome).toBe('resolved');
    expect(resolution.best?.name).toBe('calculateTotal');
    expect(resolution.best?.origin).toBe('same-file');
  });
});

describe('scenario: imported symbol typo repair', () => {
  it('resolves against a name bound by an import statement', () => {
    const resolution = resolveUndefinedName(
      { ruleId: 'TS2304', message: "Cannot find name 'useSate'." },
      sources({ imports: () => [candidate('useState', 'import')] }),
    );
    expect(resolution.outcome).toBe('resolved');
    expect(resolution.best?.name).toBe('useState');
    expect(resolution.best?.origin).toBe('import');
  });

  it('extracts local binding names from every import shape it must handle', () => {
    expect(importedNames("import { useState, useEffect } from 'react';")).toEqual([
      'useState',
      'useEffect',
    ]);
    // An alias binds the alias, not the original — that is the name in scope.
    expect(importedNames("import { render as renderDom } from 'react-dom';")).toContain(
      'renderDom',
    );
    expect(importedNames("import React from 'react';")).toContain('React');
    expect(importedNames("import * as path from 'node:path';")).toContain('path');
    expect(importedNames('from typing import Optional, Dict')).toEqual(['Optional', 'Dict']);
    expect(importedNames('import numpy as np')).toContain('np');
  });
});

describe('scenario: multiple candidate ambiguity', () => {
  it('refuses to pick between two equally close names', () => {
    // `lenght` sits one transposition from `length` and equally close to `lenght2`-shaped siblings.
    const resolution = resolveUndefinedName(
      { ruleId: 'TS2304', message: "Cannot find name 'valu'." },
      sources({ sameFile: () => [candidate('value'), candidate('val')] }),
    );
    // Both are one edit away, so neither wins by the required margin.
    expect(resolution.outcome).toBe('ambiguous');
    expect(resolution.best).toBeNull();
    // Crucially the candidates are still carried — the AI path gets them as context.
    expect(resolution.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('still resolves when one candidate is clearly ahead of the other', () => {
    const resolution = resolveUndefinedName(
      { ruleId: 'TS2304', message: "Cannot find name 'usestate'." },
      sources({ sameFile: () => [candidate('useState'), candidate('useStatx')] }),
    );
    expect(resolution.outcome).toBe('resolved');
    expect(resolution.best?.name).toBe('useState');
  });
});

describe('scenario: no candidate found', () => {
  it('reports no candidates when nothing in any scope is close', () => {
    const resolution = resolveUndefinedName(
      { ruleId: 'TS2304', message: "Cannot find name 'somethingEntirelyNovel'." },
      sources({ sameFile: () => [candidate('render')], project: () => [candidate('parse')] }),
    );
    expect(resolution.outcome).toBe('no-candidates');
    expect(resolution.candidates).toEqual([]);
    expect(resolution.best).toBeNull();
  });

  it('reports not-applicable when the message shape is unfamiliar', () => {
    const resolution = resolveUndefinedName(
      { ruleId: 'TS2304', message: 'no quoted name here' },
      sources({ sameFile: () => [candidate('anything')] }),
    );
    expect(resolution.outcome).toBe('not-applicable');
  });
});

describe('scenario: project-wide symbol resolution', () => {
  it('falls through to the project index when the file and its imports have nothing', () => {
    const resolution = resolveUndefinedName(
      { ruleId: 'TS2304', message: "Cannot find name 'formatCurrncy'." },
      sources({
        sameFile: () => [candidate('render')],
        project: () => [
          { name: 'formatCurrency', origin: 'project', location: at(9, 1, 'src/x.ts') },
        ],
      }),
    );
    expect(resolution.outcome).toBe('resolved');
    expect(resolution.best?.origin).toBe('project');
    expect(resolution.best?.location?.file).toBe('src/x.ts');
  });

  it('prefers a local match and never consults the project index when one exists', () => {
    let projectConsulted = false;
    const resolution = resolveUndefinedName(
      { ruleId: 'TS2304', message: "Cannot find name 'useSate'." },
      sources({
        sameFile: () => [candidate('useState')],
        project: () => {
          projectConsulted = true;
          return [];
        },
      }),
    );
    expect(resolution.outcome).toBe('resolved');
    expect(projectConsulted).toBe(false); // the expensive source stays unpaid
  });
});

describe('scenario: confidence threshold behaviour', () => {
  it('a match above the threshold becomes an automatic repair', () => {
    expect(decide('useSate', [candidate('useState')]).outcome).toBe('resolved');
  });

  it('a match below the threshold is repairable but NOT automatic', () => {
    // `usr` → `user` is a real candidate (similarity 0.75) but well under the autofix bar, so it is
    // offered to the AI path rather than applied silently.
    const resolution = decide('usr', [candidate('user')]);
    expect(resolution.outcome).toBe('ambiguous');
    expect(resolution.best).toBeNull();
    expect(resolution.candidates).toHaveLength(1);
  });

  it('a weak match is not even a candidate', () => {
    expect(decide('foo', [candidate('for')]).outcome).toBe('no-candidates');
  });
});

describe('scenario: regression validation — the edit is located safely or not built at all', () => {
  const SOURCE = 'const total = 1;\nconsole.log(totl);\n';

  it('locates the identifier and produces an exact replacement range', () => {
    const edit = buildRenameAutofix(SOURCE, 'totl', 'total', { startLine: 2, startCol: 13 });
    expect(edit).not.toBeNull();
    const [start, end] = edit!.range;
    expect(SOURCE.slice(start, end)).toBe('totl'); // the range covers exactly the typo
    expect(SOURCE.slice(0, start) + edit!.text + SOURCE.slice(end)).toBe(
      'const total = 1;\nconsole.log(total);\n',
    );
  });

  it('refuses to build an edit when the identifier is not on the reported line', () => {
    expect(buildRenameAutofix(SOURCE, 'totl', 'total', { startLine: 1, startCol: 1 })).toBeNull();
  });

  it('refuses when the line does not exist at all', () => {
    expect(buildRenameAutofix(SOURCE, 'totl', 'total', { startLine: 99, startCol: 1 })).toBeNull();
  });

  it('matches whole words only — a substring of a longer identifier is never edited', () => {
    // `totl` appears inside `subtotlValue`, but only as a substring; there is no standalone `totl`.
    const src = 'const subtotlValue = 1;\n';
    expect(locateIdentifier(src, 'totl', { startLine: 1, startCol: 7 })).toBeNull();
  });

  it('tolerates a column that is off by one in either direction', () => {
    // Tools disagree about 0- vs 1-based columns; proximity matching must survive that rather than
    // silently editing the wrong token.
    for (const startCol of [12, 13, 14]) {
      const edit = buildRenameAutofix(SOURCE, 'totl', 'total', { startLine: 2, startCol });
      expect(edit, `col ${String(startCol)}`).not.toBeNull();
      expect(SOURCE.slice(edit!.range[0], edit!.range[1])).toBe('totl');
    }
  });

  it('picks the occurrence nearest the reported column when the name repeats on one line', () => {
    const src = 'foo(totl, totl);\n';
    const first = locateIdentifier(src, 'totl', { startLine: 1, startCol: 5 });
    const second = locateIdentifier(src, 'totl', { startLine: 1, startCol: 11 });
    expect(first).toBe(4);
    expect(second).toBe(10);
    expect(src.slice(second!, second! + 4)).toBe('totl');
  });
});
