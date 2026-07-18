import type { DirEntryInfo, WorkspaceInfo } from '@fixora/shared-types';
import { create } from 'zustand';

import { invoke } from '../../lib/bridge.js';

/**
 * The file-tree state (TanStack Query owns wire *results*, but the tree is a stateful,
 * incrementally-built structure the user manipulates — expand/collapse — so it is client state,
 * ADR-015). The model is a **flat list of visible nodes**: the standard shape for a virtualised
 * tree, because the renderer windows a flat array far more cheaply than a nested one, and
 * expand/collapse is a splice rather than a re-render of a deep structure.
 *
 * The tree loads **lazily** — a directory's children are fetched only when it is expanded — which
 * is what keeps opening a 10,000-file repo under two seconds: we never hold or render the whole
 * tree, only the path the user has opened.
 */
export type TreeNode = {
  relPath: string;
  name: string;
  kind: 'dir' | 'file';
  language: string | null;
  depth: number;
  expanded: boolean;
  loading: boolean;
};

/**
 * Where to reveal + highlight in the editor after a jump (e.g. clicking a finding). `token` bumps on
 * every request so clicking the same finding twice re-reveals it, even though the target is identical.
 */
export type RevealTarget = {
  relPath: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  token: number;
};

type WorkspaceState = {
  workspace: WorkspaceInfo | null;
  nodes: TreeNode[];
  /** relPath of the file the user last activated in the tree (drives the editor). */
  selectedFile: string | null;
  /** The location the editor should scroll to + highlight, or null (a plain file open). */
  revealTarget: RevealTarget | null;
  opening: boolean;
  error: string | null;

  /** On launch, adopt a workspace main already restored (reopen-last-project) and load its tree. */
  hydrateCurrent: () => Promise<void>;
  pickAndOpen: () => Promise<void>;
  openPath: (path: string) => Promise<void>;
  toggleDir: (relPath: string) => Promise<void>;
  selectFile: (relPath: string) => void;
  /** Open a file AND scroll to + highlight a range — what clicking a finding does. */
  revealAt: (location: {
    file: string;
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
  }) => void;
  /** Re-fetch a directory's children in place (used by the file watcher). */
  refreshDir: (relPath: string) => Promise<void>;
};

let revealToken = 0;

function entryToNode(entry: DirEntryInfo, depth: number): TreeNode {
  return { ...entry, depth, expanded: false, loading: false };
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspace: null,
  nodes: [],
  selectedFile: null,
  revealTarget: null,
  opening: false,
  error: null,

  hydrateCurrent: async () => {
    const current = await invoke('workspace:current', {});
    if (!current.ok || current.value.workspace === null) return;
    const root = await invoke('fs:listDir', { relPath: '' });
    set({
      workspace: current.value.workspace,
      nodes: root.ok ? root.value.entries.map((e) => entryToNode(e, 0)) : [],
    });
  },

  pickAndOpen: async () => {
    const picked = await invoke('workspace:pickFolder', {});
    if (picked.ok && picked.value.path !== null) {
      await get().openPath(picked.value.path);
    }
  },

  openPath: async (path) => {
    set({ opening: true, error: null });
    const opened = await invoke('workspace:open', { path });
    if (!opened.ok) {
      set({ opening: false, error: opened.error.message });
      return;
    }
    const root = await invoke('fs:listDir', { relPath: '' });
    set({
      workspace: opened.value.workspace,
      nodes: root.ok ? root.value.entries.map((e) => entryToNode(e, 0)) : [],
      selectedFile: null,
      revealTarget: null,
      opening: false,
      error: root.ok ? null : root.error.message,
    });
  },

  toggleDir: async (relPath) => {
    const { nodes } = get();
    const index = nodes.findIndex((n) => n.relPath === relPath && n.kind === 'dir');
    if (index === -1) return;
    const node = nodes[index];
    if (node === undefined) return;

    if (node.expanded) {
      // Collapse: drop every deeper node that follows, until depth returns to this node's level.
      const rest = nodes.slice(index + 1);
      let removeCount = 0;
      while (removeCount < rest.length && (rest[removeCount]?.depth ?? 0) > node.depth) {
        removeCount += 1;
      }
      const next = [...nodes];
      next.splice(index + 1, removeCount);
      next[index] = { ...node, expanded: false };
      set({ nodes: next });
      return;
    }

    // Expand: fetch children and splice them in after the directory.
    set({ nodes: withNode(nodes, index, { loading: true }) });
    const listed = await invoke('fs:listDir', { relPath });
    const current = get().nodes;
    const at = current.findIndex((n) => n.relPath === relPath);
    if (at === -1) return;
    const parent = current[at];
    if (parent === undefined) return;

    if (!listed.ok) {
      set({ nodes: withNode(current, at, { loading: false }), error: listed.error.message });
      return;
    }
    const children = listed.value.entries.map((e) => entryToNode(e, parent.depth + 1));
    const next = [...current];
    next[at] = { ...parent, expanded: true, loading: false };
    next.splice(at + 1, 0, ...children);
    set({ nodes: next });
  },

  selectFile: (relPath) => {
    set({ selectedFile: relPath, revealTarget: null });
  },

  revealAt: (location) => {
    revealToken += 1;
    set({
      selectedFile: location.file,
      revealTarget: {
        relPath: location.file,
        startLine: location.startLine,
        startCol: location.startCol,
        endLine: location.endLine,
        endCol: location.endCol,
        token: revealToken,
      },
    });
  },

  refreshDir: async (relPath) => {
    const { nodes } = get();
    if (relPath === '') {
      const root = await invoke('fs:listDir', { relPath: '' });
      if (root.ok) set({ nodes: reconcileChildren(nodes, '', 0, root.value.entries) });
      return;
    }
    const node = nodes.find((n) => n.relPath === relPath && n.kind === 'dir');
    // Only re-fetch a directory that is currently expanded; a collapsed one reloads on next open.
    if (!node?.expanded) return;
    const listed = await invoke('fs:listDir', { relPath });
    if (listed.ok) {
      set({ nodes: reconcileChildren(get().nodes, relPath, node.depth + 1, listed.value.entries) });
    }
  },
}));

function withNode(nodes: TreeNode[], index: number, patch: Partial<TreeNode>): TreeNode[] {
  const node = nodes[index];
  if (node === undefined) return nodes;
  const next = [...nodes];
  next[index] = { ...node, ...patch };
  return next;
}

/**
 * Replace the immediate children of `parentRel` in the flat node list with a fresh listing, keeping
 * the expansion of directories that still exist — so a watcher-driven refresh does not collapse
 * everything the user had open. Children that vanished (and their descendants) are dropped.
 */
function reconcileChildren(
  nodes: TreeNode[],
  parentRel: string,
  childDepth: number,
  entries: DirEntryInfo[],
): TreeNode[] {
  const parentIndex = parentRel === '' ? -1 : nodes.findIndex((n) => n.relPath === parentRel);
  const start = parentIndex + 1;
  let end = start;
  while (end < nodes.length && (nodes[end]?.depth ?? -1) >= childDepth) end += 1;

  const previous = new Map(nodes.slice(start, end).map((n) => [n.relPath, n] as const));
  const rebuilt: TreeNode[] = [];
  for (const entry of entries) {
    const prior = previous.get(entry.relPath);
    if (prior?.expanded === true) {
      // Keep this expanded dir and its already-loaded descendants exactly as they were.
      const from = nodes.findIndex((n) => n.relPath === entry.relPath);
      let to = from + 1;
      while (to < nodes.length && (nodes[to]?.depth ?? -1) > prior.depth) to += 1;
      rebuilt.push(...nodes.slice(from, to));
    } else {
      rebuilt.push(entryToNode(entry, childDepth));
    }
  }
  return [...nodes.slice(0, start), ...rebuilt, ...nodes.slice(end)];
}
