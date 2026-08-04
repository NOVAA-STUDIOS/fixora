import type * as monaco from 'monaco-editor';
import { describe, expect, it } from 'vitest';

import { setActiveEditor } from './active-editor.js';
import {
  disposeAllModels,
  disposeModel,
  isModelDirty,
  markModelSaved,
  modelFor,
  refreshModelText,
} from './models.js';

/**
 * Dirty tracking, pinned after a real bug: the first version marked a file dirty whenever Monaco
 * emitted a content event, and running the app showed a tab dotted as unsaved that the user had
 * never typed into. On an editor where the next keystroke is Ctrl+S, that is a file written for no
 * reason — so dirty is now derived from Monaco's alternative version id against a saved baseline,
 * and that behaviour is tested rather than eyeballed.
 *
 * A fake Monaco is enough here: this module's whole job is bookkeeping *around* the model, and the
 * version id is the only thing it reads.
 */
function fakeMonaco(): { m: typeof monaco; bump: (path: string) => void } {
  const versions = new Map<string, number>();
  const texts = new Map<string, string>();

  const m = {
    Uri: { parse: (s: string) => ({ path: s, toString: () => s }) },
    editor: {
      createModel: (content: string, _lang: string, uri: { path: string }) => {
        versions.set(uri.path, 1);
        texts.set(uri.path, content);
        return {
          isDisposed: () => false,
          dispose: () => undefined,
          getAlternativeVersionId: () => versions.get(uri.path) ?? 1,
          getValue: () => texts.get(uri.path) ?? '',
          getFullModelRange: () => ({}),
          pushEditOperations: (_a: unknown, edits: { text: string }[]) => {
            texts.set(uri.path, edits[0]?.text ?? '');
            versions.set(uri.path, (versions.get(uri.path) ?? 1) + 1);
            return null;
          },
        };
      },
    },
  } as unknown as typeof monaco;

  return { m, bump: (path) => versions.set(path, (versions.get(path) ?? 1) + 1) };
}

describe('dirty tracking', () => {
  it('a freshly opened file is clean', () => {
    const { m } = fakeMonaco();
    modelFor(m, 'clean.ts', 'const a = 1;', 'typescript');
    expect(isModelDirty('clean.ts')).toBe(false);
    disposeModel('clean.ts');
  });

  it('an edit makes it dirty, and saving makes it clean again', () => {
    const { m, bump } = fakeMonaco();
    modelFor(m, 'edited.ts', 'const a = 1;', 'typescript');

    bump('fixora:/edited.ts');
    expect(isModelDirty('edited.ts')).toBe(true);

    markModelSaved('edited.ts');
    expect(isModelDirty('edited.ts')).toBe(false);
    disposeModel('edited.ts');
  });

  it('applying a repair rebaselines — the buffer matches disk, so it is not dirty', () => {
    const { m } = fakeMonaco();
    modelFor(m, 'repaired.ts', 'const a = 1;', 'typescript');

    refreshModelText('repaired.ts', 'const a = 2;');
    expect(isModelDirty('repaired.ts')).toBe(false);
    disposeModel('repaired.ts');
  });

  it('forgets a file entirely when it is closed', () => {
    const { m, bump } = fakeMonaco();
    modelFor(m, 'closed.ts', 'x', 'typescript');
    bump('fixora:/closed.ts');
    expect(isModelDirty('closed.ts')).toBe(true);

    disposeModel('closed.ts');
    // No model, no dirt — a closed file must never keep a tab dotted or block a workspace close.
    expect(isModelDirty('closed.ts')).toBe(false);
  });
});

/**
 * Model-ownership regression. The cache OWNS these models; the mounted editor BORROWS one at a
 * time. Disposing a borrowed model without telling the editor left it holding a disposed model, and
 * every worker-backed request already in flight against it (tokenization, links, diff) rejected —
 * surfacing as `Uncaught (in promise) Cancelled: Cancelled` and `no diff result available`.
 *
 * Closing a tab (`disposeModel`) and switching workspace (`disposeAllModels`) both did exactly
 * this, which is why the console errors survived fixing the diff editor alone.
 */
describe('model ownership — a borrowed model is detached before it is disposed', () => {
  function mountedEditorShowing(model: unknown) {
    let current: unknown = model;
    const editor = {
      getModel: () => current,
      setModel: (next: unknown) => {
        current = next;
      },
      currentModel: () => current,
    };
    setActiveEditor(editor as unknown as monaco.editor.IStandaloneCodeEditor);
    return editor;
  }

  it('disposeModel detaches the model the editor is showing, before disposing it', () => {
    const { m } = fakeMonaco();
    const model = modelFor(m, 'open.ts', 'const a = 1;', 'typescript');
    const editor = mountedEditorShowing(model);

    disposeModel('open.ts');

    // Detached — the editor is not left pointing at a disposed model.
    expect(editor.currentModel()).toBeNull();
    setActiveEditor(null);
  });

  it('leaves an editor showing a DIFFERENT file alone', () => {
    const { m } = fakeMonaco();
    const shown = modelFor(m, 'shown.ts', 'const a = 1;', 'typescript');
    modelFor(m, 'other.ts', 'const b = 2;', 'typescript');
    const editor = mountedEditorShowing(shown);

    disposeModel('other.ts');

    // Untouched: only the model actually being disposed may be detached.
    expect(editor.currentModel()).toBe(shown);
    setActiveEditor(null);
    disposeModel('shown.ts');
  });

  it('disposeAllModels detaches the borrowed one too — the workspace-switch path', () => {
    const { m } = fakeMonaco();
    const a = modelFor(m, 'a.ts', 'const a = 1;', 'typescript');
    modelFor(m, 'b.ts', 'const b = 2;', 'typescript');
    const editor = mountedEditorShowing(a);

    disposeAllModels();

    expect(editor.currentModel()).toBeNull();
    setActiveEditor(null);
  });

  it('is a no-op when no editor is mounted', () => {
    const { m } = fakeMonaco();
    modelFor(m, 'headless.ts', 'const a = 1;', 'typescript');
    setActiveEditor(null);
    expect(() => {
      disposeModel('headless.ts');
    }).not.toThrow();
  });
});
