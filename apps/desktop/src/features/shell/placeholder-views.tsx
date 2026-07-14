import { useUiStore, type ActivityView as ActivityViewName } from '../../stores/ui-store.js';

/**
 * The primary-panel content, switched by the activity rail. In M1 these are honest placeholders
 * that name the milestone each real surface arrives in — the shell is real; the features are not
 * yet. They are labelled regions so the shell is fully navigable and screen-reader-coherent today.
 */
const copy: Record<ActivityViewName, { title: string; body: string }> = {
  workspace: { title: 'Workspace', body: 'Open a folder — the file tree arrives in M2.' },
  findings: { title: 'Findings', body: 'Grounded findings arrive in M3.' },
  history: { title: 'History', body: 'Local session history arrives in M2.' },
  settings: { title: 'Settings', body: 'Theme, density, BYOK and privacy controls — M2.' },
};

export function ActivityView(): React.JSX.Element {
  const activeView = useUiStore((s) => s.activeView);
  // `copy` is keyed by the exact ActivityView union, so this lookup is total — no fallback needed.
  const { title, body } = copy[activeView];

  return (
    <section
      aria-label={title}
      className="flex h-full flex-col gap-1 border-r border-border-subtle bg-canvas p-4"
    >
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      <p className="text-xs text-fg-muted">{body}</p>
    </section>
  );
}
