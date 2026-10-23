import { describe, expect, it } from 'vitest';

import { indexSmartContextFiles, rankSmartProjectContext, resolveSmartContextImports } from './smart-project-context.js';

const files = indexSmartContextFiles([
  'src/features/task.ts',
  'src/features/helpers.ts',
  'src/api/client.ts',
  'src/api/client-view.tsx',
  'src/api/client.test.ts',
  'src/other.ts',
  'tests/task.test.ts',
  'src/features/index.ts',
]);

function rank(prompt: string, overrides: Partial<Parameters<typeof rankSmartProjectContext>[1]> = {}) {
  return rankSmartProjectContext(files, {
    prompt,
    activeFile: 'src/features/task.ts',
    selectedCodeFile: null,
    selectedCode: null,
    sourceContent: null,
    explicitFiles: [],
    openTabs: [],
    ...overrides,
  });
}

describe('Zappr Smart Project Context', () => {
  it('ranks direct filename and path matches first', () => {
    expect(rank('Please explain src/api/client.ts')[0]).toMatchObject({ path: 'src/api/client.ts', reason: 'prompt-match' });
    expect(rank('Please explain client-view.tsx')[0]?.path).toBe('src/api/client-view.tsx');
  });

  it('ranks a uniquely resolved active-file import above same-directory files', () => {
    const imports = resolveSmartContextImports('src/features/task.ts', "import { client } from '../api/client';", files);
    expect(imports).toEqual(['src/api/client.ts']);
    expect(rank('explain the task', { sourceContent: "import { client } from '../api/client';" })[0]).toMatchObject({ path: 'src/api/client.ts', reason: 'import' });
  });

  it('ranks same-directory candidates below direct and imported matches', () => {
    const candidates = rank('Please inspect src/api/client.ts', { sourceContent: "import './helpers';" });
    expect(candidates[0]?.path).toBe('src/api/client.ts');
    expect(candidates[1]?.reason).toBe('import');
    const nearby = candidates.findIndex((candidate) => candidate.reason === 'same-directory');
    expect(nearby).toBeGreaterThan(1);
  });

  it('never duplicates explicit mentions, selected code, or the active file', () => {
    const candidates = rank('inspect selected.ts and active.ts', {
      activeFile: 'src/other.ts',
      selectedCode: 'snippet',
      selectedCodeFile: 'src/features/helpers.ts',
      explicitFiles: ['src/api/client.ts'],
    });
    expect(candidates.map((candidate) => candidate.path)).not.toContain('src/other.ts');
    expect(candidates.map((candidate) => candidate.path)).not.toContain('src/features/helpers.ts');
    expect(candidates.map((candidate) => candidate.path)).not.toContain('src/api/client.ts');
  });

  it('caps the result count, normalizes paths, and is deterministic', () => {
    const input = { activeFile: null, openTabs: ['src/api/client.ts', 'src/other.ts'] };
    const first = rank('inspect task', input);
    expect(first).toHaveLength(4);
    expect(first).toEqual(rank('inspect task', input));
    expect(indexSmartContextFiles(['../outside.ts', 'C:\\outside.ts', '/outside.ts']).map((entry) => entry.path)).toEqual([]);
  });

  it('skips ambiguous import resolution', () => {
    const ambiguous = indexSmartContextFiles(['src/api/client.ts', 'src/api/client.tsx']);
    expect(resolveSmartContextImports('src/task.ts', "import './api/client';", ambiguous)).toEqual([]);
  });

  it('invalidates old workspace candidates when rebuilt with new metadata', () => {
    const nextWorkspace = indexSmartContextFiles(['lib/new.ts']);
    expect(rankSmartProjectContext(nextWorkspace, {
      prompt: 'open task', activeFile: null, selectedCodeFile: null, selectedCode: null,
      sourceContent: null, explicitFiles: [], openTabs: ['src/features/task.ts'],
    })).toEqual([]);
  });
});
