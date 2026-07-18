import type * as monaco from 'monaco-editor';
import { describe, expect, it } from 'vitest';

import {
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
