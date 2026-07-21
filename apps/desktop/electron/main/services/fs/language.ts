import { basename, extname } from 'node:path';

/**
 * Map a filename to a language id. Used by the file index (M3 will group findings by language) and
 * by the editor to pick a Monaco grammar. The launch languages are TypeScript/JavaScript, Python
 * and Go (ADR-025); everything else is tagged so the tree can show an icon, but only those three
 * are "deep". `null` means "unknown / binary-ish", which the reader treats as not-openable-as-text.
 */
const BY_EXTENSION: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
  '.json': 'json',
  '.md': 'markdown',
  '.css': 'css',
  '.html': 'html',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.sh': 'shell',
  '.sql': 'sql',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.rb': 'ruby',
};

const BY_FILENAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  '.gitignore': 'ignore',
};

export function detectLanguage(filename: string): string | null {
  const lower = basename(filename).toLowerCase();
  if (lower in BY_FILENAME) return BY_FILENAME[lower] ?? null;
  const ext = extname(lower);
  return BY_EXTENSION[ext] ?? null;
}

/**
 * Languages the analysis pipeline runs on. The four launch languages get the full deterministic
 * pipeline (tree-sitter symbols + external tools, ADR-025); `json` is Tier B — validation-only, no
 * symbols — but still an analysis target so its validator sees the file.
 */
export function isDeepLanguage(language: string | null): boolean {
  return (
    language === 'typescript' ||
    language === 'javascript' ||
    language === 'python' ||
    language === 'go' ||
    language === 'json'
  );
}
