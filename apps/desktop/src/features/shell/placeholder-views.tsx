import { useUiStore } from '../../stores/ui-store.js';

/**
 * The primary-panel content for the views whose real surfaces have not landed yet. `workspace` has
 * its own panel (the file tree) from M2; `settings` from M2 too. `findings` and `history` are
 * honest placeholders naming the milestone each arrives in — labelled regions so the shell stays
 * navigable and screen-reader-coherent today.
 */
const copy: Record<string, { title: string; body: string }> = {
  findings: { title: 'Findings', body: 'Grounded findings arrive in M3.' },
  history: { title: 'History', body: 'Local session history — searchable in a later milestone.' },
  settings: { title: 'Settings', body: 'Open Settings from the activity rail.' },
};

export function PrimaryPlaceholder(): React.JSX.Element {
  const activeView = useUiStore((s) => s.activeView);
  const content = copy[activeView] ?? { title: 'Fixora', body: '' };

  return (
    <section
      aria-label={content.title}
      className="flex h-full flex-col gap-1 border-r border-border-subtle bg-canvas p-4"
    >
      <h2 className="text-sm font-semibold text-fg">{content.title}</h2>
      <p className="text-xs text-fg-muted">{content.body}</p>
    </section>
  );
}
