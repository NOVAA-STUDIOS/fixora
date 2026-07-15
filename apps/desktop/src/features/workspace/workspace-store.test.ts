import type { DirEntryInfo, WorkspaceInfo } from '@fixora/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceStore } from './workspace-store.js';

/**
 * The file tree is a **flat list of visible nodes** with lazy directory loading (workspace-store.ts).
 * These tests exercise the two operations most likely to regress: expand/collapse (does the splice
 * keep the flat list consistent and depth-ordered?) and watcher-driven `refreshDir` (does it keep
 * the expansion of directories that still exist rather than collapsing everything the user opened?).
 *
 * The bridge is stubbed with a directory map, so `fs:listDir` returns children per path exactly as
 * the real main process would — no Electron, no disk.
 */

const workspace: WorkspaceInfo = {
  id: 'ws1',
  rootPath: '/repo',
  name: 'repo',
  lastOpenedAt: 1,
};

function dir(name: string, relPath: string): DirEntryInfo {
  return { name, relPath, kind: 'dir', language: null };
}
function file(name: string, relPath: string, language: string | null = null): DirEntryInfo {
  return { name, relPath, kind: 'file', language };
}

/** relPath → its immediate children, as `fs:listDir` would return them. */
let tree: Record<string, DirEntryInfo[]>;

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

function installBridge(): void {
  const invoke = vi.fn((channel: string, req: { relPath?: string; path?: string }) => {
    switch (channel) {
      case 'workspace:current':
        return Promise.resolve(ok({ workspace }));
      case 'workspace:open':
        return Promise.resolve(ok({ workspace }));
      case 'fs:listDir':
        return Promise.resolve(ok({ entries: tree[req.relPath ?? ''] ?? [] }));
      default:
        throw new Error(`unexpected channel ${channel}`);
    }
  });
  (window as unknown as { fixora: unknown }).fixora = {
    invoke,
    subscribe: () => () => undefined,
  };
}

function relPaths(): string[] {
  return useWorkspaceStore.getState().nodes.map((n) => n.relPath);
}

describe('useWorkspaceStore tree', () => {
  beforeEach(() => {
    tree = {
      '': [dir('src', 'src'), file('README.md', 'README.md', 'markdown')],
      src: [dir('editor', 'src/editor'), file('index.ts', 'src/index.ts', 'typescript')],
      'src/editor': [file('editor-store.ts', 'src/editor/editor-store.ts', 'typescript')],
    };
    installBridge();
    useWorkspaceStore.setState({
      workspace: null,
      nodes: [],
      selectedFile: null,
      opening: false,
      error: null,
    });
  });

  it('hydrateCurrent adopts the restored workspace and loads its root', async () => {
    await useWorkspaceStore.getState().hydrateCurrent();
    expect(useWorkspaceStore.getState().workspace).toEqual(workspace);
    expect(relPaths()).toEqual(['src', 'README.md']);
  });

  it('expands a directory in place, one level deep', async () => {
    await useWorkspaceStore.getState().hydrateCurrent();
    await useWorkspaceStore.getState().toggleDir('src');
    expect(relPaths()).toEqual(['src', 'src/editor', 'src/index.ts', 'README.md']);
    const srcNode = useWorkspaceStore.getState().nodes.find((n) => n.relPath === 'src');
    expect(srcNode?.expanded).toBe(true);
    expect(useWorkspaceStore.getState().nodes.find((n) => n.relPath === 'src/editor')?.depth).toBe(
      1,
    );
  });

  it('collapses a directory and drops all of its descendants', async () => {
    const store = useWorkspaceStore.getState();
    await store.hydrateCurrent();
    await store.toggleDir('src');
    await useWorkspaceStore.getState().toggleDir('src/editor'); // nested expand
    expect(relPaths()).toContain('src/editor/editor-store.ts');
    await useWorkspaceStore.getState().toggleDir('src'); // collapse the top dir
    expect(relPaths()).toEqual(['src', 'README.md']);
    expect(useWorkspaceStore.getState().nodes.find((n) => n.relPath === 'src')?.expanded).toBe(
      false,
    );
  });

  it('refreshDir keeps a nested expanded directory open when a sibling is added', async () => {
    const store = useWorkspaceStore.getState();
    await store.hydrateCurrent();
    await store.toggleDir('src');
    await useWorkspaceStore.getState().toggleDir('src/editor');
    expect(relPaths()).toContain('src/editor/editor-store.ts');

    // Watcher fires: a new file appeared under src. The expanded src/editor must survive.
    tree['src'] = [
      dir('editor', 'src/editor'),
      file('index.ts', 'src/index.ts', 'typescript'),
      file('new.ts', 'src/new.ts', 'typescript'),
    ];
    await useWorkspaceStore.getState().refreshDir('src');

    const paths = relPaths();
    expect(paths).toContain('src/new.ts');
    expect(paths).toContain('src/editor/editor-store.ts'); // still expanded
    expect(
      useWorkspaceStore.getState().nodes.find((n) => n.relPath === 'src/editor')?.expanded,
    ).toBe(true);
  });

  it('refreshDir drops a directory (and its descendants) that vanished', async () => {
    const store = useWorkspaceStore.getState();
    await store.hydrateCurrent();
    await store.toggleDir('src');
    await useWorkspaceStore.getState().toggleDir('src/editor');

    tree['src'] = [file('index.ts', 'src/index.ts', 'typescript')]; // editor/ deleted
    await useWorkspaceStore.getState().refreshDir('src');

    const paths = relPaths();
    expect(paths).not.toContain('src/editor');
    expect(paths).not.toContain('src/editor/editor-store.ts');
    expect(paths).toContain('src/index.ts');
  });

  it('refreshDir ignores a collapsed directory (it reloads on next open)', async () => {
    const store = useWorkspaceStore.getState();
    await store.hydrateCurrent();
    // src is collapsed. A refresh must be a no-op — no children spliced in.
    await useWorkspaceStore.getState().refreshDir('src');
    expect(relPaths()).toEqual(['src', 'README.md']);
  });

  it('selectFile records the activated file', () => {
    useWorkspaceStore.getState().selectFile('README.md');
    expect(useWorkspaceStore.getState().selectedFile).toBe('README.md');
  });
});
