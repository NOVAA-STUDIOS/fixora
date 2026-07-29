import { ChevronDownIcon, ChevronRightIcon, FileIcon, FolderIcon, RefreshIcon, VirtualList, cn } from '@fixora/ui';

import { useRowHeight } from '../../hooks/use-density-metrics.js';

import { useWorkspaceStore, type TreeNode } from './workspace-store.js';

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
  const toggleDir = useWorkspaceStore((s) => s.toggleDir);
  const selectFile = useWorkspaceStore((s) => s.selectFile);
  const rowHeight = useRowHeight();

  // A successfully opened workspace with zero visible entries (an empty folder, or one where
  // everything is `.gitignore`d) previously rendered a blank pane indistinguishable from "still
  // loading" or "broken" (beta audit A2, Empty states finding).
  if (nodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
        <FolderIcon className="size-5 text-fg-muted" />
        <p className="text-sm font-medium text-fg">No visible files</p>
        <p className="max-w-xs text-xs leading-relaxed text-fg-muted">
          This folder is empty, or everything in it is excluded by .gitignore.
        </p>
      </div>
    );
  }

  const activate = (node: TreeNode): void => {
    if (node.kind === 'dir') {
      void toggleDir(node.relPath);
    } else {
      selectFile(node.relPath);
    }
  };

  return (
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
          selected={node.relPath === selected}
          onActivate={() => {
            activate(node);
          }}
        />
      )}
    />
  );
}

function TreeRow({
  node,
  height,
  selected,
  onActivate,
}: {
  node: TreeNode;
  height: number;
  selected: boolean;
  onActivate: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      // Not a tab stop of its own — `VirtualList`'s container is the single stop, and arrow keys
      // move a roving `aria-activedescendant` instead. A click still activates the row directly;
      // only Tab-based reachability changes.
      tabIndex={-1}
      onClick={onActivate}
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
    </button>
  );
}
