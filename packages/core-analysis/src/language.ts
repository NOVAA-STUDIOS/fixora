import type { Language } from '@fixora/shared-types';

/**
 * Map a file path to the language Fixora analyzes it as (ADR-025: three deep). This drives both
 * grammar selection and which tool adapters apply. `.tsx`/`.jsx` map to their base language for
 * tooling purposes; the M3 grammar for `typescript` is the `.ts` dialect, so JSX-heavy files still
 * extract their top-level symbols under tree-sitter's error recovery (a known, documented edge).
 */
const EXTENSION_LANGUAGE: Record<string, Language> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  pyi: 'python',
  go: 'go',
};

/** The analysis language for a path, or `null` if it is not one of the three we analyze. */
export function languageForPath(path: string): Language | null {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  return EXTENSION_LANGUAGE[ext] ?? null;
}
