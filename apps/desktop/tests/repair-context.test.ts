import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Finding } from '@fixora/shared-types';
import { afterEach, describe, expect, it } from 'vitest';

import {
  projectConventions,
  repairNeighbours,
  tsconfigStrict,
} from '../electron/main/ai/repair-context.js';

/**
 * Repair Context Engine v3, main side: slice the analyzer-selected context ranges into prompt
 * neighbours, and detect the Project Metadata from the project itself — never assumed.
 */

function finding(over: Partial<Finding['evidence']>): Finding {
  return {
    id: 'x',
    source: 'tsc',
    ruleId: 'TS2322',
    severity: 'error',
    category: 'correctness',
    location: { file: 'a.ts', startLine: 6, startCol: 3, endLine: 6, endCol: 8 },
    message: 'm',
    evidence: { snippet: '', relatedLocations: [], toolOutput: null, ...over },
    fixable: false,
    repair: 'ai-required',
    confidence: 1,
  };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

describe('repairNeighbours', () => {
  const content = [
    'import { useEffect } from "react";',
    'interface S {',
    '  count: number;',
    '}',
    '',
  ].join('\n');

  it('slices each selected range into a labelled neighbour', () => {
    const parts = repairNeighbours(
      content,
      finding({
        contextRanges: [
          { label: "import from 'react'", startLine: 1, endLine: 1 },
          { label: 'interface S', startLine: 2, endLine: 4 },
        ],
      }),
    );
    expect(parts).toEqual([
      { label: "import from 'react'", text: 'import { useEffect } from "react";' },
      { label: 'interface S', text: 'interface S {\n  count: number;\n}' },
    ]);
  });

  it('returns nothing when the finding carries no context ranges', () => {
    expect(repairNeighbours(content, finding({}))).toEqual([]);
  });
});

describe('projectConventions (Project Metadata)', () => {
  it('always reports the language and a preservation rule', () => {
    const root = mkdtempSync(join(tmpdir(), 'fx-conv-'));
    dirs.push(root);
    const c = projectConventions({
      language: 'python',
      fileContent: 'x = 1\n',
      workspaceRoot: root,
    });
    expect(c[0]).toBe('Language: python');
    expect(c.some((l) => /preserve/i.test(l))).toBe(true);
    expect(c.some((l) => l.includes('React'))).toBe(false); // not a React file
  });

  it('detects React from a real import', () => {
    const root = mkdtempSync(join(tmpdir(), 'fx-conv-'));
    dirs.push(root);
    const c = projectConventions({
      language: 'typescript',
      fileContent: 'import { useState } from "react";\nexport const x = 1;\n',
      workspaceRoot: root,
    });
    expect(c.some((l) => l.includes('React'))).toBe(true);
  });

  it('does NOT flag React for an unrelated "react" substring', () => {
    const root = mkdtempSync(join(tmpdir(), 'fx-conv-'));
    dirs.push(root);
    const c = projectConventions({
      language: 'typescript',
      fileContent: 'const reactionTime = 5; // not react\n',
      workspaceRoot: root,
    });
    expect(c.some((l) => l.includes('React'))).toBe(false);
  });

  it('detects TypeScript strict mode from the workspace tsconfig', () => {
    const root = mkdtempSync(join(tmpdir(), 'fx-conv-'));
    dirs.push(root);
    writeFileSync(
      join(root, 'tsconfig.json'),
      '{\n  // strict!\n  "compilerOptions": { "strict": true },\n}\n',
    );
    expect(tsconfigStrict(root)).toBe(true);
    const c = projectConventions({
      language: 'typescript',
      fileContent: 'export const x = 1;\n',
      workspaceRoot: root,
    });
    expect(c.some((l) => /strict mode/i.test(l))).toBe(true);
  });

  it('reports null strict when there is no tsconfig, and adds no strict convention', () => {
    const root = mkdtempSync(join(tmpdir(), 'fx-conv-'));
    dirs.push(root);
    expect(tsconfigStrict(root)).toBeNull();
    const c = projectConventions({
      language: 'typescript',
      fileContent: 'export const x = 1;\n',
      workspaceRoot: root,
    });
    expect(c.some((l) => /strict mode/i.test(l))).toBe(false);
  });
});

describe('tsconfigStrict tolerates real-world tsconfig', () => {
  it('parses a tsconfig with comments and trailing commas', () => {
    const root = mkdtempSync(join(tmpdir(), 'fx-ts-'));
    dirs.push(root);
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'tsconfig.json'),
      '{\n  /* base */\n  "compilerOptions": {\n    "strict": false,\n    "target": "ES2022",\n  },\n}\n',
    );
    expect(tsconfigStrict(root)).toBe(false);
  });
});
