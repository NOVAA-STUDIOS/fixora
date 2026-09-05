import type { WorkspaceInfo } from '@fixora/shared-types';
import {
  BookIcon,
  ClockIcon,
  FolderIcon,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SparkleIcon,
  cn,
} from '@fixora/ui';
import {
  forwardRef,
  useCallback,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';

import { invoke } from '../../lib/bridge.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { DocumentationDialog } from './documentation-dialog.js';
import { WhatsNewDialog } from './whats-new-dialog.js';

/**
 * The Home screen's Quick Actions row (Sprint F2: Welcome Experience).
 *
 * Four equally-weighted entry points beyond the primary "Open folder" hero button: the same action
 * again for anyone who scans this row instead of the hero, a fast path into recent projects that
 * doesn't require scrolling to the Recent section, and two in-app reference surfaces (Documentation,
 * What's New) that work fully offline.
 */
export function QuickActions(): React.JSX.Element {
  const pickAndOpen = useWorkspaceStore((s) => s.pickAndOpen);
  const openPath = useWorkspaceStore((s) => s.openPath);

  const [recentOpen, setRecentOpen] = useState(false);
  const [recent, setRecent] = useState<WorkspaceInfo[] | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);

  // Fetched lazily, the first time the popover opens — Quick Actions should not add a network/IPC
  // round-trip to every Home screen paint just in case the user opens this one.
  useEffect(() => {
    if (!recentOpen || recent !== null) return;
    let cancelled = false;
    void invoke('workspace:recent', {}).then((r) => {
      if (!cancelled) setRecent(r.ok ? r.value.workspaces : []);
    });
    return () => {
      cancelled = true;
    };
  }, [recentOpen, recent]);

  const openRecent = useCallback(
    (path: string) => {
      setRecentOpen(false);
      void openPath(path);
    },
    [openPath],
  );

  return (
    <section aria-label="Quick actions" className="flex flex-col gap-2.5">
      <h2 className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        Quick actions
      </h2>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <QuickActionButton
          icon={<FolderIcon className="size-6" />}
          label="Open folder"
          onClick={() => void pickAndOpen()}
        />

        <Popover open={recentOpen} onOpenChange={setRecentOpen}>
          <PopoverTrigger asChild>
            <QuickActionButton icon={<ClockIcon className="size-6" />} label="Open recent" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-1.5">
            <RecentQuickList recent={recent} onOpen={openRecent} />
          </PopoverContent>
        </Popover>

        <QuickActionButton
          icon={<BookIcon className="size-6" />}
          label="Documentation"
          onClick={() => {
            setDocsOpen(true);
          }}
        />

        <QuickActionButton
          icon={<SparkleIcon className="size-6" />}
          label="What's new"
          onClick={() => {
            setWhatsNewOpen(true);
          }}
        />
      </div>

      <DocumentationDialog open={docsOpen} onOpenChange={setDocsOpen} />
      <WhatsNewDialog open={whatsNewOpen} onOpenChange={setWhatsNewOpen} />
    </section>
  );
}

/**
 * `forwardRef` + spread props so this also works as a Radix `asChild` target (the "Open recent"
 * trigger): Radix clones the child and needs the DOM ref for positioning plus its own injected
 * props (`aria-expanded`, `data-state`, its own `onClick`) to land on the real button.
 */
const QuickActionButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode; label: string }
>(function QuickActionButton({ icon, label, className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'group flex flex-col items-center gap-2 rounded-xl border border-border-subtle bg-raised p-5',
        'text-fg-secondary transition-all duration-150',
        'hover:border-border hover:bg-hover hover:text-fg',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline',
        className,
      )}
      {...props}
    >
      <span className="flex size-8 items-center justify-center rounded-lg bg-raised text-fg-muted">
        {icon}
      </span>
      <span className="text-[13px] font-medium">{label}</span>
    </button>
  );
});

function RecentQuickList({
  recent,
  onOpen,
}: {
  recent: WorkspaceInfo[] | null;
  onOpen: (path: string) => void;
}): React.JSX.Element {
  if (recent === null) {
    return <div className="px-2 py-2 text-xs text-fg-muted">Loading…</div>;
  }
  if (recent.length === 0) {
    return (
      <div className="px-2 py-2 text-xs text-fg-muted">
        No recent projects yet — use Open folder to start one.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      {recent.slice(0, 5).map((w) => (
        <button
          key={w.id}
          type="button"
          onClick={() => {
            onOpen(w.rootPath);
          }}
          title={w.rootPath}
          className={cn(
            'flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left',
            'transition-colors duration-(--fx-motion-duration-fast) hover:bg-hover',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline',
          )}
        >
          <FolderIcon className="size-3.5 shrink-0 text-fg-muted" />
          <span className="truncate text-sm text-fg">{w.name}</span>
        </button>
      ))}
    </div>
  );
}
