import { beforeEach, describe, expect, it } from 'vitest';

import { useEditorStore } from './editor-store.js';

/**
 * The editor store owns *which files are open* and *which is active* — never their text (ADR-015:
 * Monaco owns the text). These tests pin the tab bookkeeping: no duplicate tabs, activation on
 * open, and the neighbour-activation rule when the active tab is closed (which is the part most
 * likely to regress into a null-active-tab-with-tabs-still-open bug).
 */
function reset(): void {
  useEditorStore.setState({ tabs: [], activeTab: null });
}

describe('useEditorStore', () => {
  beforeEach(reset);

  it('opens a file as a new active tab', () => {
    useEditorStore.getState().openFile('a.ts', 'typescript');
    const { tabs, activeTab } = useEditorStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ relPath: 'a.ts', name: 'a.ts', language: 'typescript' });
    expect(activeTab).toBe('a.ts');
  });

  it('does not duplicate an already-open file, but re-activates it', () => {
    const store = useEditorStore.getState();
    store.openFile('a.ts', 'typescript');
    store.openFile('b.ts', 'typescript');
    store.openFile('a.ts', 'typescript');
    const { tabs, activeTab } = useEditorStore.getState();
    expect(tabs.map((t) => t.relPath)).toEqual(['a.ts', 'b.ts']);
    expect(activeTab).toBe('a.ts');
  });

  it('derives the tab name from the path basename', () => {
    useEditorStore.getState().openFile('src/features/x.ts', null);
    expect(useEditorStore.getState().tabs[0]?.name).toBe('x.ts');
  });

  it('activates the left neighbour when the active tab is closed', () => {
    const store = useEditorStore.getState();
    store.openFile('a.ts', null);
    store.openFile('b.ts', null);
    store.openFile('c.ts', null); // c active
    useEditorStore.getState().closeTab('c.ts');
    expect(useEditorStore.getState().activeTab).toBe('b.ts');
  });

  it('activates the right neighbour when closing the first (active) tab', () => {
    const store = useEditorStore.getState();
    store.openFile('a.ts', null);
    store.openFile('b.ts', null);
    useEditorStore.getState().setActive('a.ts');
    useEditorStore.getState().closeTab('a.ts');
    expect(useEditorStore.getState().activeTab).toBe('b.ts');
  });

  it('leaves the active tab untouched when a different tab is closed', () => {
    const store = useEditorStore.getState();
    store.openFile('a.ts', null);
    store.openFile('b.ts', null); // b active
    useEditorStore.getState().closeTab('a.ts');
    const { tabs, activeTab } = useEditorStore.getState();
    expect(tabs.map((t) => t.relPath)).toEqual(['b.ts']);
    expect(activeTab).toBe('b.ts');
  });

  it('clears the active tab when the last tab is closed', () => {
    useEditorStore.getState().openFile('a.ts', null);
    useEditorStore.getState().closeTab('a.ts');
    const { tabs, activeTab } = useEditorStore.getState();
    expect(tabs).toEqual([]);
    expect(activeTab).toBeNull();
  });

  it('ignores closing a tab that is not open', () => {
    useEditorStore.getState().openFile('a.ts', null);
    useEditorStore.getState().closeTab('ghost.ts');
    expect(useEditorStore.getState().tabs).toHaveLength(1);
  });
});
