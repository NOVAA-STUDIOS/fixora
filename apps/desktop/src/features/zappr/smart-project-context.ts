import { normalizeMentionPath } from './mention-context.js';

export const SMART_CONTEXT_MAX_FILES = 4;

export type SmartContextReason = 'prompt-match' | 'import' | 'same-directory' | 'open-tab' | 'name-match';

export type SmartContextCandidate = {
  path: string;
  reason: SmartContextReason;
};

export type SmartContextIndexEntry = {
  path: string;
  normalizedPath: string;
  name: string;
  directory: string;
  terms: string[];
};

export type SmartContextInput = {
  prompt: string;
  activeFile: string | null;
  selectedCodeFile: string | null;
  selectedCode: string | null;
  sourceContent: string | null;
  explicitFiles: readonly string[];
  openTabs: readonly string[];
};

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;

function pathTerms(path: string): string[] {
  return [...new Set(path.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2))];
}

function containsPathReference(prompt: string, path: string): boolean {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w/-])${escaped}(?=$|[^\\w/-])`, 'i').test(prompt);
}

/** Build searchable path metadata only when workspace/tab metadata changes. */
export function indexSmartContextFiles(files: readonly string[]): SmartContextIndexEntry[] {
  const entries = new Map<string, SmartContextIndexEntry>();
  for (const path of files) {
    const normalized = normalizeMentionPath(path);
    if (normalized === null) continue;
    const normalizedPath = normalized.toLowerCase();
    if (entries.has(normalizedPath)) continue;
    const slash = normalized.lastIndexOf('/');
    const name = slash < 0 ? normalized : normalized.slice(slash + 1);
    entries.set(normalizedPath, {
      path: normalized,
      normalizedPath,
      name: name.toLowerCase(),
      directory: slash < 0 ? '' : normalized.slice(0, slash).toLowerCase(),
      terms: pathTerms(normalized),
    });
  }
  return [...entries.values()];
}

function resolveRelativeImport(sourceFile: string, specifier: string, files: readonly SmartContextIndexEntry[]): string | null {
  const source = normalizeMentionPath(sourceFile);
  if (source === null || !specifier.startsWith('.')) return null;
  const sourceDir = source.includes('/') ? source.slice(0, source.lastIndexOf('/')) : '';
  const parts = [...(sourceDir === '' ? [] : sourceDir.split('/')), ...specifier.split('/')];
  const normalizedParts: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (normalizedParts.length === 0) return null;
      normalizedParts.pop();
    } else {
      normalizedParts.push(part);
    }
  }
  if (normalizedParts.length === 0) return null;
  const base = normalizedParts.join('/');
  const hasSupportedExtension = SOURCE_EXTENSIONS.some((extension) => base.toLowerCase().endsWith(extension));
  const candidates = hasSupportedExtension
    ? [base]
    : [base, ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`), ...SOURCE_EXTENSIONS.map((extension) => `${base}/index${extension}`)];
  const matches = files.filter((entry) => candidates.includes(entry.path));
  return matches.length === 1 ? matches[0]?.path ?? null : null;
}

/** Resolve only common relative JS/TS imports, and only when workspace metadata gives one match. */
export function resolveSmartContextImports(
  sourceFile: string | null,
  sourceContent: string | null,
  files: readonly SmartContextIndexEntry[],
): string[] {
  if (sourceFile === null || sourceContent === null) return [];
  const matches = new Set<string>();
  const importPatterns = [
    /\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"](\.[^'"]+)['"]/g,
    /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of importPatterns) {
    for (const match of sourceContent.slice(0, 100_000).matchAll(pattern)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const resolved = resolveRelativeImport(sourceFile, specifier, files);
      if (resolved !== null) matches.add(resolved);
    }
  }
  return [...matches];
}

/** Deterministic, path-metadata-only ranking. Call at submit time, not on each keystroke. */
export function rankSmartProjectContext(
  index: readonly SmartContextIndexEntry[],
  input: SmartContextInput,
  limit = SMART_CONTEXT_MAX_FILES,
): SmartContextCandidate[] {
  const normalized = (path: string | null): string | null => path === null ? null : normalizeMentionPath(path)?.toLowerCase() ?? null;
  const excluded = new Set(input.explicitFiles.map((path) => normalized(path)).filter((path): path is string => path !== null));
  const selectedPath = normalized(input.selectedCode !== null ? input.selectedCodeFile : null);
  const activePath = normalized(input.activeFile);
  if (selectedPath !== null) excluded.add(selectedPath);
  if (activePath !== null) excluded.add(activePath);

  const sourceFile = input.selectedCode !== null ? input.selectedCodeFile ?? input.activeFile : input.activeFile;
  const importPaths = new Set(resolveSmartContextImports(sourceFile, input.sourceContent, index).map((path) => path.toLowerCase()));
  const source = normalized(sourceFile);
  const sourceDirectory = source === null ? null : source.includes('/') ? source.slice(0, source.lastIndexOf('/')) : '';
  const openTabs = new Set(input.openTabs.map((path) => normalized(path)).filter((path): path is string => path !== null));
  const prompt = input.prompt.toLowerCase().replace(/\\/g, '/');
  const promptTerms = new Set(pathTerms(prompt));

  const ranked = index.flatMap((entry) => {
    if (excluded.has(entry.normalizedPath)) return [];
    let score = 0;
    let reason: SmartContextReason = 'name-match';
    if (containsPathReference(prompt, entry.normalizedPath)) {
      score = 1000;
      reason = 'prompt-match';
    } else if (containsPathReference(prompt, entry.name)) {
      score = 900;
      reason = 'prompt-match';
    } else if (importPaths.has(entry.normalizedPath)) {
      score = 800;
      reason = 'import';
    } else if (sourceDirectory !== null && entry.directory === sourceDirectory && entry.normalizedPath !== source) {
      score = 400;
      reason = 'same-directory';
    } else if (openTabs.has(entry.normalizedPath)) {
      score = 300;
      reason = 'open-tab';
    }
    const overlap = entry.terms.filter((term) => promptTerms.has(term)).length;
    if (score === 0 && overlap > 0) {
      score = 100 + overlap;
      reason = 'name-match';
    }
    if (score === 0) return [];
    return [{ candidate: { path: entry.path, reason }, score }];
  });

  return ranked
    .sort((a, b) => b.score - a.score || a.candidate.path.localeCompare(b.candidate.path))
    .slice(0, Math.max(0, limit))
    .map((item) => item.candidate);
}
