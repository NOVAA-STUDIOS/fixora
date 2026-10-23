export function normalizeMentionPath(path: string): string | null {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized === '' || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return null;
  const parts = normalized.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return null;
  return normalized;
}

export interface MentionFileIndexEntry {
  path: string;
  normalizedPath: string;
  normalizedName: string;
}

/** Build once when the workspace file list changes, not for every input keystroke. */
export function indexMentionFiles(files: readonly string[]): MentionFileIndexEntry[] {
  return [...new Set(files)].map((path) => ({
    path,
    normalizedPath: path.toLowerCase(),
    normalizedName: path.slice(path.lastIndexOf('/') + 1).toLowerCase(),
  }));
}

export function searchMentionFiles(index: readonly MentionFileIndexEntry[], query: string, limit = 6): string[] {
  const normalizedQuery = query.toLowerCase();
  return index
    .filter((file) => file.normalizedPath.includes(normalizedQuery))
    .map((file) => ({
      path: file.path,
      rank: file.normalizedName === normalizedQuery ? 0
        : file.normalizedName.startsWith(normalizedQuery) ? 1
          : file.normalizedPath.startsWith(normalizedQuery) ? 2 : 3,
    }))
    .sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((file) => file.path);
}

export function rankMentionFiles(files: readonly string[], query: string, limit = 6): string[] {
  return searchMentionFiles(indexMentionFiles(files), query, limit);
}

export function insertMention(text: string, queryStart: number, queryEnd: number, path: string): { text: string; cursor: number } {
  const before = text.slice(0, queryStart);
  const after = text.slice(queryEnd);
  const inserted = `${before}@${path}`;
  const needsSpace = after === '' || !/^\s/.test(after);
  const nextText = `${inserted}${needsSpace ? ' ' : ''}${after}`;
  return { text: nextText, cursor: inserted.length + (needsSpace ? 1 : 0) };
}

export function parseMentionPaths(text: string): string[] {
  return [...new Set([...text.matchAll(/(?:^|\s)@([\w./-]+)/g)]
    .map((match) => normalizeMentionPath(match[1] ?? ''))
    .filter((path): path is string => path !== null))];
}

export function activeFallbackPath(activeFile: string | null, selectedFile: string | null, mentionedFiles: readonly string[]): string | null {
  if (activeFile === null || activeFile === selectedFile || mentionedFiles.includes(activeFile)) return null;
  return normalizeMentionPath(activeFile);
}
