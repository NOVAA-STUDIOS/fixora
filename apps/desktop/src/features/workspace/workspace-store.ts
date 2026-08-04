import type { DirEntryInfo, WorkspaceInfo } from '@fixora/shared-types';
import { create } from 'zustand';

import { invoke } from '../../lib/bridge.js';
import { useAiStore } from '../../stores/ai-store.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useEditorStore } from '../editor/editor-store.js';
import { disposeAllModels } from '../editor/models.js';
import { useFindingsStore } from '../findings/findings-store.js';
import { useHistoryStore } from '../history/history-store.js';

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

/**
 * The steps startup actually performs, reported as each one completes. There are two, because two is
 * how many round-trips launching takes — the launch screen narrates these rather than a script.
 */
export type HydrationStage = 'workspace' | 'files';

/**
 * A workspace transition blocked on unsaved editor changes, waiting for the user to confirm or
 * cancel via `WorkspaceSwitchGuard` (mounted once, in `AppShell`, so every entry point that can
 * leave the current workspace shares the exact same confirmation — beta audit A2, Workspace
 * switching finding: "Close folder" checked for unsaved changes, but switching straight to a
 * different recent project via any other entry point did not, and silently discarded them).
 */
export type PendingWorkspaceAction = { type: 'switch'; path: string } | { type: 'close' };

type WorkspaceState = {
  workspace: WorkspaceInfo | null;
  nodes: TreeNode[];
  /** relPath of the file the user last activated in the tree (drives the editor). */
  selectedFile: string | null;
  /** The location the editor should scroll to + highlight, or null (a plain file open). */
  revealTarget: RevealTarget | null;
  opening: boolean;
  error: string | null;
  /** Set instead of acting, whenever leaving the current workspace would discard unsaved edits. */
  pendingAction: PendingWorkspaceAction | null;

  /** On launch, adopt a workspace main already restored (reopen-last-project) and load its tree. */
  hydrateCurrent: (onStage?: (stage: HydrationStage) => void) => Promise<void>;
  pickAndOpen: () => Promise<void>;
  /** Switch to a different project. Blocked behind `pendingAction` if the current one has unsaved
   *  edits — every call site (Recent Projects, Quick Actions, the Open menu, reopen-last, the
   *  command palette) goes through this one function, so none of them can bypass the guard. */
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
  /** Close the workspace: main forgets the root, the tree/editor empty out. Same guard as `openPath`. */
  close: () => Promise<void>;
  /** Re-open the most recently used folder — the "reopen last project" a returning user expects. */
  reopenLast: () => Promise<void>;
  /** Re-fetch a directory's children in place (used by the file watcher). */
  refreshDir: (relPath: string) => Promise<void>;
  /** The user confirmed discarding unsaved edits — carry out the action `pendingAction` named. */
  confirmPendingAction: () => Promise<void>;
  /** The user backed out — stay on the current workspace, unsaved edits untouched. */
  cancelPendingAction: () => void;
};

let revealToken = 0;

/**
 * Everything scoped to a workspace, cleared in one place.
 *
 * This existed only inside `close()`, and only for findings. `openPath` — the way users actually
 * switch projects, by clicking a recent — cleared nothing at all, so the previous project's
 * findings, editor tabs, Monaco models and AI proposal all survived into the next one. The findings
 * were correctly stored and correctly queried; they were simply still on screen, under a different
 * project's name. That is the leak the database tests could never have caught, because it is not in
 * the database.
 *
 * Every transition calls this, so adding a new workspace-scoped store means adding one line here
 * rather than remembering two call sites.
 */
function resetWorkspaceScopedState(): void {
  useFindingsStore.setState({
    findings: [],
    summary: null,
    status: 'idle',
    selectedId: null,
    ignoredIds: [],
    error: null,
  });
  // Tabs name paths that belong to the old project; the models behind them hold its text.
  useEditorStore.getState().closeAll();
  disposeAllModels();
  // A proposal is a patch against a specific file in a specific project. Applying one after a
  // switch would write the old project's fix into the new project's file.
  useAiStore.getState().dismiss();
  useHistoryStore.setState({ entries: [], loaded: false });
}

function entryToNode(entry: DirEntryInfo, depth: number): TreeNode {
  return { ...entry, depth, expanded: false, loading: false };
}

/** The actual switch, unconditional — callers are responsible for having already cleared the
 *  unsaved-edits gate (or having nothing to gate). Extracted so both the direct path (nothing
 *  dirty) and the confirmed path (`confirmPendingAction`) share one implementation. */
async function performOpenPath(
  set: (partial: Partial<WorkspaceState>) => void,
  path: string,
): Promise<void> {
  set({ opening: true, error: null });
  const opened = await invoke('workspace:open', { path });
  if (!opened.ok) {
    set({ opening: false, error: opened.error.message });
    return;
  }
  // AFTER the open succeeds, so a failed switch leaves the current project intact.
  resetWorkspaceScopedState();
  const root = await invoke('fs:listDir', { relPath: '' });
  set({
    workspace: opened.value.workspace,
    nodes: root.ok ? root.value.entries.map((e) => entryToNode(e, 0)) : [],
    selectedFile: null,
    revealTarget: null,
    opening: false,
    error: root.ok ? null : root.error.message,
  });
}

async function performClose(set: (partial: Partial<WorkspaceState>) => void): Promise<void> {
  await invoke('workspace:close', {});
  resetWorkspaceScopedState();
  set({ workspace: null, nodes: [], selectedFile: null, revealTarget: null, error: null });
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspace: null,
  nodes: [],
  selectedFile: null,
  revealTarget: null,
  opening: false,
  error: null,
  pendingAction: null,

  hydrateCurrent: async (onStage) => {
    // `onStage` reports what has *actually* completed, so the launch screen narrates real work
    // rather than a scripted sequence. Startup is genuinely two round-trips; there is no third.
    // Throws on a genuine failure so the launch screen can report it. Swallowing these left the app
    // to start into a silently empty tree, with nothing to indicate the restore had failed at all.
    const current = await invoke('workspace:current', {});
    if (!current.ok) throw new Error(current.error.message);
    onStage?.('workspace');

    // Restore is decided HERE, not in main.
    //
    // It used to work the other way round: main called restoreLast() on every launch and the
    // renderer closed the workspace again if the user had opted out. That left a real window in
    // which the last project was open, indexed and answering workspace-scoped queries — for a user
    // who had explicitly asked for a fresh session. It also made "which workspace is current?"
    // depend on when you asked, which is how findings appear to be attributed to the wrong project
    // even though storage and retrieval are correctly scoped (proven: see workspace-isolation
    // tests). Main now opens nothing at startup, so there is no window.
    if (current.value.workspace === null) {
      // Opt-in restore. `reopenLast` goes through workspace:open, which authorizes the path as a
      // known recent — the same guard as any other open, not a bypass.
      if (useUiStore.getState().reopenLastProject) await get().reopenLast();
      return;
    }

    // A workspace is already open (the user opened one before this ran, or a previous session left
    // one). Honour the preference exactly as before.
    if (!useUiStore.getState().reopenLastProject) {
      await invoke('workspace:close', {});
      return;
    }

    const root = await invoke('fs:listDir', { relPath: '' });
    if (!root.ok) throw new Error(root.error.message);
    set({
      workspace: current.value.workspace,
      nodes: root.value.entries.map((e) => entryToNode(e, 0)),
    });
    onStage?.('files');
  },

  pickAndOpen: async () => {
    const picked = await invoke('workspace:pickFolder', {});
    if (picked.ok && picked.value.path !== null) {
      await get().openPath(picked.value.path);
    }
  },

  openPath: async (path) => {
    // Blocked behind confirmation if the current workspace has unsaved edits — the exact same
    // check and the exact same dialog (`WorkspaceSwitchGuard`) that `close()` uses below, so every
    // way of leaving the current workspace is protected identically (beta audit A2).
    if (useEditorStore.getState().dirty.length > 0) {
      set({ pendingAction: { type: 'switch', path } });
      return;
    }
    await performOpenPath(set, path);
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

  close: async () => {
    // Same guard as `openPath`: closing with unsaved edits open is exactly as destructive as
    // switching to a different project with them open, and now goes through the same
    // confirmation rather than each call site remembering to check `dirty` itself.
    if (useEditorStore.getState().dirty.length > 0) {
      set({ pendingAction: { type: 'close' } });
      return;
    }
    await performClose(set);
  },

  confirmPendingAction: async () => {
    const action = get().pendingAction;
    if (action === null) return;
    set({ pendingAction: null });
    if (action.type === 'close') {
      await performClose(set);
    } else {
      await performOpenPath(set, action.path);
    }
  },

  cancelPendingAction: () => {
    set({ pendingAction: null });
  },

  reopenLast: async () => {
    const recent = await invoke('workspace:recent', {});
    const last = recent.ok ? recent.value.workspaces[0] : undefined;
    if (last === undefined) {
      // Nothing to reopen — fall back to the picker rather than leaving a dead button.
      await get().pickAndOpen();
      return;
    }
    await get().openPath(last.rootPath);
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

