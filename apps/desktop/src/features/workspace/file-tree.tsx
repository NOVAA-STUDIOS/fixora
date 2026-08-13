import type { Severity } from '@fixora/shared-types';
import { ChevronDownIcon, ChevronRightIcon, FileIcon, FolderIcon, RefreshIcon, VirtualList, cn } from '@fixora/ui';
import { useEffect, useRef, useState } from 'react';

import { useRowHeight } from '../../hooks/use-density-metrics.js';
import { invoke } from '../../lib/bridge.js';
import { useAiStore } from '../../stores/ai-store.js';
import { useFindingsStore } from '../findings/findings-store.js';

import { useFileActions } from './file-context-menu.js';
import { useWorkspaceStore, type TreeNode } from './workspace-store.js';

const SEVERITY_RANK: Record<Severity, number> = { error: 2, warning: 1, info: 0 };
const SEVERITY_DOT: Record<Severity, string> = {
  error: 'bg-danger',
  warning: 'bg-warn',
  info: 'bg-border-strong',
};

/** Bursts of `summary` changes (a debounced refresh on every `analysis:findingsAdded`, roughly
 * every 200ms while a large project streams findings) must collapse into one fetch, not one per
 * tick — an unfiltered fetch of a large project's whole findings list, refired every ~200ms for
 * the duration of a multi-minute analysis run, is a real, measured freeze, not a hypothetical one. */
const FILE_SEVERITY_DEBOUNCE_MS = 1500;

/**
 * Worst severity per file, for the tree's problem dots. Queried unfiltered (not from the findings
 * store's own `findings`, which reflects whatever severity filter the Problems panel currently has
 * active) — the same reasoning `code-editor.tsx`'s error squiggles already follow: the tree must
 * show every file with a problem regardless of what the panel is filtered to.
 */
function useFileSeverity(): Map<string, Severity> {
  const summary = useFindingsStore((s) => s.summary);
  const [bySeverity, setBySeverity] = useState<Map<string, Severity>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (timerRef.current !== null) clearTimeout(timerRef.current);

    const fire = (): void => {
      // An AI repair call is main-process work of its own (the provider fetch, then verification
      // on the analysis worker) — background traffic unrelated to it firing in the same window
      // compounds whatever main is already busy with. Reschedule rather than fetch now; the next
      // attempt re-checks, so this drains on its own once the repair settles.
      if (useAiStore.getState().status === 'running') {
        timerRef.current = setTimeout(fire, FILE_SEVERITY_DEBOUNCE_MS);
        return;
      }
      performance.mark('file-severity-fetch-start');
      void invoke('analysis:list', {}).then((result) => {
        performance.mark('file-severity-fetch-end');
        performance.measure('file-severity-fetch', 'file-severity-fetch-start', 'file-severity-fetch-end');
        if (cancelled || !result.ok) return;
        const map = new Map<string, Severity>();
        for (const f of result.value.findings) {
          const current = map.get(f.location.file);
          if (current === undefined || SEVERITY_RANK[f.severity] > SEVERITY_RANK[current]) {
            map.set(f.location.file, f.severity);
          }
        }
        setBySeverity(map);
      });
    };
    timerRef.current = setTimeout(fire, FILE_SEVERITY_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [summary]);

  return bySeverity;
}

/**
 * The virtualised file tree (roadmap M2). It renders the workspace store's flat visible-node list
 * through `VirtualList`, so a repo with tens of thousands of files never puts more than a screenful
 * of rows in the DOM. Directories expand lazily on click; a file activates the editor.
 *
 * Keyboard navigation (Arrow Up/Down, Home/End, Enter/Space) is `VirtualList`'s job — it owns the
 * roving active row and the listbox semantics. Rows here are `tabIndex={-1}`: the container is the
 * single tab stop, exactly as a native `<select>` behaves, rather than every visible row being its
 * own stop (beta audit A2, File tree keyboard-navigation finding).
 */
/** Indentation stops growing past this depth so the filename never leaves a narrow pane. */
const MAX_INDENT_DEPTH = 12;

export function FileTree(): React.JSX.Element {
  const nodes = useWorkspaceStore((s) => s.nodes);
  const selected = useWorkspaceStore((s) => s.selectedFile);
  const selectedDir = useWorkspaceStore((s) => s.selectedDir);
  const toggleDir = useWorkspaceStore((s) => s.toggleDir);
  const selectFile = useWorkspaceStore((s) => s.selectFile);
  const selectDir = useWorkspaceStore((s) => s.selectDir);
  const rowHeight = useRowHeight();
  const { openMenu, menu } = useFileActions();
  const fileSeverity = useFileSeverity();

  // A successfully opened workspace with zero visible entries (an empty folder, or one where
  // everything is `.gitignore`d) previously rendered a blank pane indistinguishable from "still
  // loading" or "broken" (beta audit A2, Empty states finding).
  if (nodes.length === 0) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center"
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu({ relPath: '', kind: 'root' }, e.clientX, e.clientY);
        }}
      >
        <FolderIcon className="size-5 text-fg-muted" />
        <p className="text-sm font-medium text-fg">No visible files</p>
        <p className="max-w-xs text-xs leading-relaxed text-fg-muted">
          This folder is empty, or everything in it is excluded by .gitignore.
        </p>
        {menu}
      </div>
    );
  }

  const activate = (node: TreeNode): void => {
    if (node.kind === 'dir') {
      // Selected as well as expanded: the selection is what the "+" button creates into, so a
      // folder the user just clicked has to become the target — that is the whole point of the
      // smart-target behaviour, and expanding alone would leave the target at the root.
      selectDir(node.relPath);
      void toggleDir(node.relPath);
    } else {
      selectFile(node.relPath);
    }
  };

  return (
    <>
      <VirtualList
        label="File tree"
        items={nodes}
        getKey={(node) => node.relPath}
        estimateRowHeight={rowHeight}
        onActivate={activate}
        renderItem={(node) => (
          <TreeRow
            node={node}
            height={rowHeight}
            selected={node.relPath === (node.kind === 'dir' ? selectedDir : selected)}
            severity={fileSeverity.get(node.relPath)}
            onActivate={() => {
              activate(node);
            }}
            onContextMenu={(x, y) => {
              openMenu({ relPath: node.relPath, kind: node.kind }, x, y);
            }}
          />
        )}
      />
      {menu}
    </>
  );
}

function TreeRow({
  node,
  height,
  selected,
  severity,
  onActivate,
  onContextMenu,
}: {
  node: TreeNode;
  height: number;
  selected: boolean;
  severity?: Severity | undefined;
  onActivate: () => void;
  onContextMenu: (x: number, y: number) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      // Not a tab stop of its own — `VirtualList`'s container is the single stop, and arrow keys
      // move a roving `aria-activedescendant` instead. A click still activates the row directly;
      // only Tab-based reachability changes.
      tabIndex={-1}
      onClick={onActivate}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
      // Indent by depth. The chevron column is fixed so files and folders align.
      // The height must be the virtualizer's stride exactly, or rows gap or overlap; both come from
      // the same density token rather than a class that would have to be kept in step by hand.
      style={{
        // Capped: unbounded indentation walks the filename straight out of a narrow side pane, and
        // deep trees (node_modules, nested monorepo packages) are exactly where it happens.
        paddingLeft: `${String(Math.min(node.depth, MAX_INDENT_DEPTH) * 12 + 4)}px`,
        height: `${String(height)}px`,
      }}
      className={cn(
        'flex w-full min-w-0 items-center gap-1 pr-2 text-left text-sm',
        'hover:bg-hover',
        selected ? 'bg-active text-fg' : 'text-fg-secondary',
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-fg-muted">
        {node.kind === 'dir' ? (
          node.loading ? (
            // Directory-expand feedback (beta audit A2, Loading states finding): a slow disk or
            // network share previously gave no indication anything was happening between the
            // click and the listing arriving.
            <RefreshIcon className="size-3.5 animate-spin" />
          ) : node.expanded ? (
            <ChevronDownIcon className="size-3.5" />
          ) : (
            <ChevronRightIcon className="size-3.5" />
          )
        ) : (
          <FileIcon className="size-3.5" />
        )}
      </span>
      {/* min-w-0: a flex child defaults to min-width:auto, which refuses to shrink below its text
          and makes `truncate` a no-op — a long filename would push the row into a sideways scroll. */}
      <span className="min-w-0 truncate">{node.name}</span>
      {severity !== undefined && (
        <span
          aria-label={`Has ${severity}s`}
          className={cn('size-1.5 shrink-0 rounded-full', SEVERITY_DOT[severity])}
        />
      )}
    </button>
  );
}
