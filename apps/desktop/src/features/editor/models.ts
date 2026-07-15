import type * as monaco from 'monaco-editor';

/**
 * Monaco text models, cached by workspace-relative path. Monaco models **own the text** (ADR-015),
 * including the undo stack, so there is exactly one model per open file and it is never recreated
 * while the file stays open — recreating it is the classic Monaco bug (lost undo, cursor jumps).
 * The store owns which tabs are open; this owns their text; nothing mirrors.
 */
const cache = new Map<string, monaco.editor.ITextModel>();

/** Our language ids → Monaco's. Unknown maps to plaintext. */
function monacoLanguage(language: string | null): string {
  const map: Record<string, string> = {
    typescript: 'typescript',
    javascript: 'javascript',
    python: 'python',
    go: 'go',
    json: 'json',
    markdown: 'markdown',
    css: 'css',
    html: 'html',
    yaml: 'yaml',
    sql: 'sql',
    shell: 'shell',
    rust: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    ruby: 'ruby',
    dockerfile: 'dockerfile',
  };
  return language !== null ? (map[language] ?? 'plaintext') : 'plaintext';
}

export function modelFor(
  m: typeof monaco,
  relPath: string,
  content: string,
  language: string | null,
): monaco.editor.ITextModel {
  const existing = cache.get(relPath);
  if (existing !== undefined && !existing.isDisposed()) return existing;

  // A stable, unique URI per file so Monaco's language services key on it correctly.
  const uri = m.Uri.parse(`fixora:/${encodeURI(relPath)}`);
  const model = m.editor.createModel(content, monacoLanguage(language), uri);
  cache.set(relPath, model);
  return model;
}

export function hasModel(relPath: string): boolean {
  const model = cache.get(relPath);
  return model !== undefined && !model.isDisposed();
}

export function disposeModel(relPath: string): void {
  cache.get(relPath)?.dispose();
  cache.delete(relPath);
}
