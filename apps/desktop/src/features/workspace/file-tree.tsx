import { ChevronDownIcon, ChevronRightIcon, FileIcon, VirtualList, cn } from '@fixora/ui';

import { useRowHeight } from '../../hooks/use-density-metrics.js';

import { useWorkspaceStore, type TreeNode } from './workspace-store.js';

/**
 * The virtualised file tree (roadmap M2). It renders the workspace store's flat visible-node list
 * through `VirtualList`, so a repo with tens of thousands of files never puts more than a screenful
 * of rows in the DOM. Directories expand lazily on click; a file activates the editor.
 *
 * Every row is a real button so the tree is operable by keyboard (Standards §3); the listbox
 * semantics come from `VirtualList`.
 */
/** Indentation stops growing past this depth so the filename never leaves a narrow pane. */
const MAX_INDENT_DEPTH = 12;

export function FileTree(): React.JSX.Element {
  const nodes = useWorkspaceStore((s) => s.nodes);
  const selected = useWorkspaceStore((s) => s.selectedFile);
  const toggleDir = useWorkspaceStore((s) => s.toggleDir);
  const selectFile = useWorkspaceStore((s) => s.selectFile);
  const rowHeight = useRowHeight();

  return (
    <VirtualList
      label="File tree"
      items={nodes}
      getKey={(node) => node.relPath}
      estimateRowHeight={rowHeight}
      renderItem={(node) => (
        <TreeRow
          node={node}
          height={rowHeight}
          selected={node.relPath === selected}
          onActivate={() => {
            if (node.kind === 'dir') {
              void toggleDir(node.relPath);
            } else {
              selectFile(node.relPath);
            }
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
        'hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline',
        selected ? 'bg-active text-fg' : 'text-fg-secondary',
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-fg-muted">
        {node.kind === 'dir' ? (
          node.expanded ? (
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
