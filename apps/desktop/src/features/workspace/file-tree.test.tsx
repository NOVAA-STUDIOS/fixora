import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as WorkspaceStoreModule from './workspace-store.js';
import type { TreeNode } from './workspace-store.js';

/**
 * Beta audit A2 remediation: the file tree's empty state, its directory-loading indicator, and —
 * the most consequential fix — real keyboard operability (Enter/Space activating whichever row
 * `VirtualList`'s roving `aria-activedescendant` currently points to, not just a mouse click).
 *
 * jsdom computes no real layout, so `@tanstack/react-virtual`'s visible-range math (driven by the
 * scroll container's `clientHeight`) always resolves to zero rows unless a height is given — the
 * same limitation `virtual-list.test.tsx` documents. A fixed stub height here is enough for these
 * few-row fixtures to actually mount in the DOM, which the empty-state and loading-indicator
 * assertions need (unlike the pure keyboard/ARIA tests in `virtual-list.test.tsx`, which only read
 * `aria-activedescendant`'s value and never needed the row itself present).
 */
const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
beforeAll(() => {
  // `@tanstack/virtual-core` measures the scroll element via `offsetHeight`, not `clientHeight`.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });
});
afterAll(() => {
  if (originalOffsetHeight) {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
  }
});

// FileTree now queries `analysis:list` directly (problem-severity dots, unfiltered by the Problems
// panel's own filter — see `useFileSeverity` in file-tree.tsx) rather than only going through the
// mocked workspace store, so it needs the same bridge mock `findings-panel.test.tsx` uses.
const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../lib/bridge.js', () => ({ invoke, subscribe: () => () => undefined }));

const toggleDir = vi.hoisted(() => vi.fn());
const selectFile = vi.hoisted(() => vi.fn());
const selectDir = vi.hoisted(() => vi.fn());
let nodes: TreeNode[] = [];
let selectedFile: string | null = null;
let selectedDir: string | null = null;

vi.mock('./workspace-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof WorkspaceStoreModule>();
  return {
    ...actual,
    useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ nodes, selectedFile, selectedDir, toggleDir, selectFile, selectDir }),
  };
});

const { FileTree } = await import('./file-tree.js');

function dirNode(relPath: string, name: string, overrides: Partial<TreeNode> = {}): TreeNode {
  return { relPath, name, kind: 'dir', language: null, depth: 0, expanded: false, loading: false, ...overrides };
}
function fileNode(relPath: string, name: string, overrides: Partial<TreeNode> = {}): TreeNode {
  return { relPath, name, kind: 'file', language: 'typescript', depth: 0, expanded: false, loading: false, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  nodes = [];
  selectedFile = null;
  selectedDir = null;
  invoke.mockResolvedValue({ ok: true, value: { findings: [] } });
});

describe('FileTree — empty state', () => {
  it('shows an explicit empty state instead of a blank tree when there are no visible files', () => {
    nodes = [];
    render(<FileTree />);
    expect(screen.getByText('No visible files')).toBeTruthy();
    expect(screen.getByText(/excluded by \.gitignore/i)).toBeTruthy();
  });

  it('renders the tree, not the empty state, once there is at least one node', () => {
    nodes = [fileNode('a.ts', 'a.ts')];
    render(<FileTree />);
    expect(screen.queryByText('No visible files')).toBeNull();
    expect(screen.getByText('a.ts')).toBeTruthy();
  });
});

describe('FileTree — directory loading feedback', () => {
  it('shows a spinning indicator in place of the chevron while a directory is loading', () => {
    nodes = [dirNode('src', 'src', { loading: true })];
    const { container } = render(<FileTree />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('shows the collapsed chevron, not a spinner, once loading is done', () => {
    nodes = [dirNode('src', 'src', { loading: false, expanded: false })];
    const { container } = render(<FileTree />);
    expect(container.querySelector('.animate-spin')).toBeNull();
  });
});

describe('FileTree — keyboard operability', () => {
  it('rows are not individually tab stops — the list container is the single stop', () => {
    nodes = [fileNode('a.ts', 'a.ts'), fileNode('b.ts', 'b.ts')];
    render(<FileTree />);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('tabindex', '-1');
    }
  });

  it('Enter on the active row selects a file', async () => {
    nodes = [fileNode('a.ts', 'a.ts'), fileNode('b.ts', 'b.ts')];
    render(<FileTree />);
    const list = screen.getByRole('listbox', { name: 'File tree' });
    list.focus();

    await userEvent.keyboard('{ArrowDown}'); // move from a.ts to b.ts
    await userEvent.keyboard('{Enter}');
    expect(selectFile).toHaveBeenCalledWith('b.ts');
  });

  it('Space on the active row toggles a directory', async () => {
    nodes = [dirNode('src', 'src'), fileNode('README.md', 'README.md')];
    render(<FileTree />);
    const list = screen.getByRole('listbox', { name: 'File tree' });
    list.focus();

    await userEvent.keyboard(' '); // activate index 0 (src) without moving
    expect(toggleDir).toHaveBeenCalledWith('src');
  });

  it('a mouse click still activates a row directly', async () => {
    nodes = [fileNode('a.ts', 'a.ts')];
    render(<FileTree />);
    await userEvent.click(screen.getByText('a.ts'));
    expect(selectFile).toHaveBeenCalledWith('a.ts');
  });
});
