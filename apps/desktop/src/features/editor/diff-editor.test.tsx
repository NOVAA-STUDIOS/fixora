import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Console-error regression for the repair diff.
 *
 * Two errors fired on every proposal change — selecting a second finding, a retry, a mode switch:
 *
 *   Uncaught (in promise) Error: no diff result available
 *   Cancelled: Cancelled
 *
 * One cause. `setModel` starts a diff computation on Monaco's worker, and that promise resolves
 * against whatever models the editor holds. The old code disposed the previous pair BEFORE swapping
 * them, so the in-flight computation was left reading disposed models: it either rejected outright
 * ("no diff result available") or was cancelled by Monaco and surfaced its cancellation
 * ("Cancelled: Cancelled"). Nothing awaited that promise, so both escaped as unhandled rejections.
 *
 * These pin the ORDER — swap first, dispose second — which is the whole fix, plus the teardown
 * detaching the model before disposing the editor.
 */

type StubModel = { id: string; disposed: boolean; dispose: () => void };
type StubPair = { original: StubModel; modified: StubModel } | null;
interface EditorStub {
  current: StubPair;
  getModel: () => StubPair;
  setModel: (next: StubPair) => void;
  getModifiedEditor: () => { onMouseDown: () => { dispose: () => void } };
  updateOptions: () => void;
  dispose: () => void;
}

const created: StubModel[] = [];
const calls: string[] = [];

const makeModel = (id: string): StubModel => {
  const model: StubModel = {
    id,
    disposed: false,
    dispose() {
      model.disposed = true;
      calls.push('dispose:' + id);
    },
  };
  created.push(model);
  return model;
};

let modelSeq = 0;
const editorStub: EditorStub = {
  current: null,
  getModel() {
    return editorStub.current;
  },
  setModel(next) {
    calls.push('setModel:' + (next === null ? 'null' : next.original.id));
    editorStub.current = next;
  },
  getModifiedEditor: () => ({ onMouseDown: () => ({ dispose: () => undefined }) }),
  updateOptions: () => undefined,
  dispose: () => {
    calls.push('editor.dispose');
  },
};

vi.mock('./monaco-setup.js', () => ({
  setupMonaco: () => ({
    editor: {
      createDiffEditor: () => editorStub,
      createModel: () => makeModel('m' + String(++modelSeq)),
      setTheme: () => undefined,
    },
  }),
}));
vi.mock('./monaco-theme.js', () => ({ themeForAppearance: () => 'fixora-dark' }));
vi.mock('../../stores/ui-store.js', () => {
  const useUiStore = (sel: (s: { theme: string }) => unknown) => sel({ theme: 'dark' });
  useUiStore.getState = () => ({ theme: 'dark' });
  return { useUiStore };
});

const { DiffEditor } = await import('./diff-editor.js');

beforeEach(() => {
  created.length = 0;
  calls.length = 0;
  modelSeq = 0;
  editorStub.current = null;
});

describe('DiffEditor — model lifecycle', () => {
  it('swaps the model BEFORE disposing the previous pair', () => {
    const { rerender } = render(
      <DiffEditor original="a" modified="b" language="javascript" />,
    );
    calls.length = 0;
    rerender(<DiffEditor original="c" modified="d" language="javascript" />);

    const swap = calls.findIndex((c) => c.startsWith('setModel:'));
    const firstDispose = calls.findIndex((c) => c.startsWith('dispose:'));
    expect(swap).toBeGreaterThanOrEqual(0);
    expect(firstDispose).toBeGreaterThanOrEqual(0);
    // The whole defect in one assertion: disposing first is what orphaned the in-flight diff.
    expect(swap).toBeLessThan(firstDispose);
  });

  it('disposes exactly the superseded models, and never the live ones', () => {
    const { rerender } = render(
      <DiffEditor original="a" modified="b" language="javascript" />,
    );
    const first = [created[0], created[1]];
    rerender(<DiffEditor original="c" modified="d" language="javascript" />);
    expect(first[0]?.disposed).toBe(true);
    expect(first[1]?.disposed).toBe(true);
    // The pair the editor is currently showing must still be alive.
    expect(editorStub.current?.original.disposed).toBe(false);
    expect(editorStub.current?.modified.disposed).toBe(false);
  });

  it('detaches the model before disposing the editor on unmount', () => {
    const { unmount } = render(
      <DiffEditor original="a" modified="b" language="javascript" />,
    );
    calls.length = 0;
    unmount();
    const detach = calls.indexOf('setModel:null');
    const disposeEditor = calls.indexOf('editor.dispose');
    expect(detach).toBeGreaterThanOrEqual(0);
    expect(detach).toBeLessThan(disposeEditor);
  });
});

describe('DiffEditor — empty state', () => {
  it('renders an empty state instead of constructing Monaco when there is nothing to diff', () => {
    render(<DiffEditor original="" modified="" language="javascript" />);
    expect(screen.getByRole('status')).toHaveTextContent('No changes to show');
    // Nothing was created, so nothing can reject: no editor, no models, no diff computation.
    expect(created).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('still renders the diff when only one side is empty — a pure deletion is a real patch', () => {
    render(<DiffEditor original="const a = 1;" modified="" language="javascript" />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(created.length).toBeGreaterThan(0);
  });
});
