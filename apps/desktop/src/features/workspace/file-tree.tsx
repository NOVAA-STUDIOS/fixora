import { ChevronDownIcon, ChevronRightIcon, FileIcon, VirtualList, cn } from '@fixora/ui';

import { useWorkspaceStore, type TreeNode } from './workspace-store.js';

/**
 * The virtualised file tree (roadmap M2). It renders the workspace store's flat visible-node list
 * through `VirtualList`, so a repo with tens of thousands of files never puts more than a screenful
 * of rows in the DOM. Directories expand lazily on click; a file activates the editor.
 *
 * Every row is a real button so the tree is operable by keyboard (Standards §3); the listbox
 * semantics come from `VirtualList`.
 */
export function FileTree(): React.JSX.Element {
  const nodes = useWorkspaceStore((s) => s.nodes);
  const selected = useWorkspaceStore((s) => s.selectedFile);
  const toggleDir = useWorkspaceStore((s) => s.toggleDir);
  const selectFile = useWorkspaceStore((s) => s.selectFile);

  return (
    <VirtualList
      label="File tree"
      items={nodes}
      getKey={(node) => node.relPath}
      estimateRowHeight={24}
      renderItem={(node) => (
        <TreeRow
          node={node}
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
  selected,
  onActivate,
}: {
  node: TreeNode;
  selected: boolean;
  onActivate: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onActivate}
      // Indent by depth. The chevron column is fixed so files and folders align.
      style={{ paddingLeft: `${String(node.depth * 12 + 4)}px` }}
      className={cn(
        'flex h-6 w-full items-center gap-1 pr-2 text-left text-sm',
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
      <span className="truncate">{node.name}</span>
    </button>
  );
}
