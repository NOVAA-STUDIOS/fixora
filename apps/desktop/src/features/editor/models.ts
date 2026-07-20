import type * as monaco from 'monaco-editor';

/**
 * Monaco text models, cached by workspace-relative path. Monaco models **own the text** (ADR-015),
 * including the undo stack, so there is exactly one model per open file and it is never recreated
 * while the file stays open — recreating it is the classic Monaco bug (lost undo, cursor jumps).
 * The store owns which tabs are open; this owns their text; nothing mirrors.
 */
const cache = new Map<string, monaco.editor.ITextModel>();

/**
 * Per-file "this is what's on disk" marker, as Monaco's *alternative version id*. Dirty state is
 * `current id !== baseline id`, not "a change event fired" — which matters twice:
 *
 * - Monaco emits content events we did not cause (EOL normalisation on model creation, for one), so
 *   event-counting marks a file dirty that the user never touched. On a tool where the next keystroke
 *   is Ctrl+S, that risks writing a file nobody edited.
 * - Undoing back to the original state returns to the baseline id, so the file correctly goes *clean*
 *   again. Event-counting can only ever ratchet dirty.
 */
const baselines = new Map<string, number>();

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
  baselines.set(relPath, model.getAlternativeVersionId());
  return model;
}

/** Does this file differ from what we last knew to be on disk? */
export function isModelDirty(relPath: string): boolean {
  const model = cache.get(relPath);
  if (model === undefined || model.isDisposed()) return false;
  return model.getAlternativeVersionId() !== baselines.get(relPath);
}

/** Record the current text as matching disk — after a successful save, or a reload. */
export function markModelSaved(relPath: string): void {
  const model = cache.get(relPath);
  if (model === undefined || model.isDisposed()) return;
  baselines.set(relPath, model.getAlternativeVersionId());
}

export function hasModel(relPath: string): boolean {
  const model = cache.get(relPath);
  return model !== undefined && !model.isDisposed();
}

/** The live text of an open file, or null if it isn't open. What `save` writes to disk. */
export function modelTextFor(relPath: string): string | null {
  const model = cache.get(relPath);
  if (model === undefined || model.isDisposed()) return null;
  return model.getValue();
}

/**
 * Replace an open file's text in place — used after a repair is applied to disk, so the buffer the
 * user is looking at shows the change. `pushEditOperations` (rather than `setValue`) keeps the undo
 * stack intact, so the user can still ctrl-Z an applied repair.
 */
export function refreshModelText(relPath: string, content: string): void {
  const model = cache.get(relPath);
  if (model === undefined || model.isDisposed()) return;
  if (model.getValue() === content) return;
  model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content }], () => null);
  // This text IS what is on disk now (the repair was applied there first), so it is the new baseline.
  baselines.set(relPath, model.getAlternativeVersionId());
}

export function disposeModel(relPath: string): void {
  cache.get(relPath)?.dispose();
  cache.delete(relPath);
  baselines.delete(relPath);
}

/**
 * Dispose every cached model. Called when the workspace changes.
 *
 * The cache is keyed by workspace-RELATIVE path, so `src/index.ts` in project A and `src/index.ts`
 * in project B are the same key. Without this, switching projects showed the previous project's
 * file contents under the new project's paths — the editor equivalent of attributing one project's
 * data to another, and invisible because the path looked right.
 */
export function disposeAllModels(): void {
  for (const model of cache.values()) model.dispose();
  cache.clear();
  baselines.clear();
}

/** The paths currently cached. Read by the workspace diagnostics panel; debugging only. */
export function cachedModelPaths(): string[] {
  return [...cache.keys()].sort();
}
