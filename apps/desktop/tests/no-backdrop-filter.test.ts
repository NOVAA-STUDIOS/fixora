import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sourceRoots = ['apps', 'packages', 'website'];
const ignoredDirectories = new Set([
  '.git',
  '.next',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'out',
  'vendor',
]);
const sourceExtensions = new Set(['.css', '.scss', '.sass', '.less', '.html', '.htm', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

function isScannedSource(path: string): boolean {
  const name = path.split(/[\\/]/).at(-1) ?? '';
  return (
    sourceExtensions.has(extname(name)) &&
    !/(?:\.test|\.spec)\.[^.]+$/i.test(name) &&
    !path.split(/[\\/]/).includes('__tests__')
  );
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function findForbiddenUsage(path: string, source: string): string[] {
  if (!isScannedSource(path)) return [];
  const executableText = stripComments(source);
  const patterns = [
    /\b(?:-webkit-)?backdrop-filter\s*:/i,
    /\bbackdropFilter\b/,
    /\bbackdrop-[a-z0-9_-]+\b/i,
  ];
  return patterns.filter((pattern) => pattern.test(executableText)).map(String);
}

function sourceFiles(directory: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) result.push(...sourceFiles(resolve(directory, entry.name)));
    } else if (entry.isFile()) {
      const path = resolve(directory, entry.name);
      if (isScannedSource(path)) result.push(path);
    }
  }
  return result;
}

describe('forbidden background-filter source guard', () => {
  it('accepts ordinary surface styles', () => {
    expect(findForbiddenUsage('sample.css', '.panel { background: color-mix(in srgb, black 90%, transparent); }')).toEqual([]);
  });

  it('rejects CSS properties, JavaScript properties, and Tailwind backdrop utilities', () => {
    expect(findForbiddenUsage('sample.css', '.panel { backdrop-filter: blur(4px); }')).not.toEqual([]);
    expect(findForbiddenUsage('sample.tsx', 'const style = { backdropFilter: "blur(4px)" };')).not.toEqual([]);
    expect(findForbiddenUsage('sample.tsx', '<div className="backdrop-blur-md" />')).not.toEqual([]);
    expect(findForbiddenUsage('sample.tsx', '<div className="backdrop-opacity-50" />')).not.toEqual([]);
  });

  it('ignores comments and documentation/prohibition text', () => {
    expect(findForbiddenUsage('sample.css', '/* backdrop-filter is forbidden */\n.panel { background: black; }')).toEqual([]);
    expect(findForbiddenUsage('docs/guide.md', 'Never use backdrop-filter or backdrop-blur.')).toEqual([]);
  });

  it('finds no forbidden runtime usage under apps, packages, or website', () => {
    const violations = sourceRoots.flatMap((root) =>
      sourceFiles(resolve(repositoryRoot, root)).flatMap((path) =>
        findForbiddenUsage(path, readFileSync(path, 'utf8')).map(
          (rule) => `${relative(repositoryRoot, path)}: ${rule}`,
        ),
      ),
    );
    expect(violations).toEqual([]);
  });
});
