import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildContext, prepareRequest } from '@fixora/core-ai';
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

/**
 * Cross-file context (PR 1: contract + gate coverage, inert).
 *
 * `contextRanges` are line ranges into the finding's OWN file and are sliced out of `content`.
 * Cross-file context cannot be: slicing a foreign range from this file's lines would silently ship
 * unrelated code to the model. So it arrives as already-resolved text and is passed through
 * verbatim. Nothing populates it yet — these prove the plumbing and, above all, that it reaches
 * `buildContext`'s `parts`, which is exactly what the secret gate scans.
 */
describe('repairNeighbours — cross-file context', () => {
  const content = ['const a = 1;', 'const b = 2;', 'const c = 3;'].join('\n');

  it('passes the resolved text through verbatim, never slicing it from this file', () => {
    const parts = repairNeighbours(
      content,
      finding({
        crossFileContext: [{ label: "from './types.ts'", text: 'interface User { id: string }' }],
      }),
    );
    expect(parts).toEqual([
      { label: "from './types.ts'", text: 'interface User { id: string }' },
    ]);
    // The give-away that it was NOT sliced: none of this file's own lines appear.
    expect(parts[0]?.text).not.toContain('const a = 1;');
  });

  it('appends after same-file ranges rather than replacing them', () => {
    const parts = repairNeighbours(
      content,
      finding({
        contextRanges: [{ label: 'local', startLine: 1, endLine: 1 }],
        crossFileContext: [{ label: 'foreign', text: 'type T = number;' }],
      }),
    );
    expect(parts.map((p) => p.label)).toEqual(['local', 'foreign']);
    expect(parts[0]?.text).toBe('const a = 1;');
    expect(parts[1]?.text).toBe('type T = number;');
  });

  it('drops a blank entry, exactly as it does for a blank same-file range', () => {
    expect(
      repairNeighbours(content, finding({ crossFileContext: [{ label: 'x', text: '   ' }] })),
    ).toEqual([]);
  });

  it('absent field behaves byte-identically to before the field existed', () => {
    const withField = repairNeighbours(
      content,
      finding({ contextRanges: [{ label: 'local', startLine: 2, endLine: 2 }], crossFileContext: [] }),
    );
    const without = repairNeighbours(
      content,
      finding({ contextRanges: [{ label: 'local', startLine: 2, endLine: 2 }] }),
    );
    expect(withField).toEqual(without);
    expect(without).toEqual([{ label: 'local', text: 'const b = 2;' }]);
  });
});

/**
 * Gate coverage — the reason this lands before anything populates the field.
 *
 * `buildContext` scans exactly `parts` (see prepare.ts), so cross-file text is only safe if it
 * arrives as a neighbour. This runs the real path end to end — crossFileContext ->
 * repairNeighbours -> buildContext -> prepareRequest — and proves a secret hidden in foreign
 * context is refused, not silently sent.
 */
describe('cross-file context is covered by the secret gate', () => {
  const clean = 'export function run() {\n  return 1;\n}\n';

  const contextFor = (f: Finding): ReturnType<typeof buildContext> =>
    buildContext({
      filePath: 'a.ts',
      language: 'typescript',
      fileContent: clean,
      finding: f,
      target: { symbolName: 'run', startLine: 1, endLine: 3 },
      neighbours: repairNeighbours(clean, f),
    });

  it('BLOCKS a secret that arrives via crossFileContext', () => {
    const prepared = prepareRequest(
      'repair',
      contextFor(
        finding({
          snippet: clean,
          crossFileContext: [
            {
              label: "from './config.ts'",
              text: 'export const TOKEN = "ghp_012345678901234567890123456789abcdef";',
            },
          ],
        }),
      ),
      { model: 'x' },
    );
    expect(prepared.ok).toBe(false);
  });

  it('clean cross-file context passes the gate and reaches the prompt', () => {
    const prepared = prepareRequest(
      'repair',
      contextFor(
        finding({
          snippet: clean,
          crossFileContext: [{ label: "from './types.ts'", text: 'interface User { id: string }' }],
        }),
      ),
      { model: 'x' },
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const user = prepared.request.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(user).toContain('interface User { id: string }');
  });
});
