import { AlertIcon, ClockIcon, FolderIcon, SettingsIcon, cn } from '@fixora/ui';

import { useUiStore, type ActivityView } from '../../stores/ui-store.js';

type RailItem = {
  view: ActivityView;
  label: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
};

const items: RailItem[] = [
  { view: 'workspace', label: 'Files', Icon: FolderIcon },
  { view: 'findings', label: 'Problems', Icon: AlertIcon },
  { view: 'history', label: 'History', Icon: ClockIcon },
  { view: 'settings', label: 'Settings', Icon: SettingsIcon },
];

/**
 * The activity rail (Design Review §5): the vertical strip that switches the primary view. Each item
 * carries a **visible label**, not just an icon — a rail of unlabelled glyphs is a guessing game for a
 * first-time user (and unusable by a screen reader). `aria-current` marks the active view, and the
 * active item gets an accent bar so "where am I" is answerable at a glance.
 */
export function ActivityRail(): React.JSX.Element {
  const activeView = useUiStore((s) => s.activeView);
  const setActiveView = useUiStore((s) => s.setActiveView);

  return (
    <nav
      aria-label="Primary"
      className="flex w-16 shrink-0 flex-col items-stretch gap-0.5 border-r border-border-subtle bg-canvas py-2"
    >
      {items.map(({ view, label, Icon }) => {
        const active = view === activeView;
        return (
          <button
            key={view}
            type="button"
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            onClick={() => {
              setActiveView(view);
            }}
            className={cn(
              'relative flex flex-col items-center gap-1 px-1 py-2 text-[10px] font-medium',
              'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring focus-visible:outline',
              active ? 'text-accent-text' : 'text-fg-muted hover:bg-hover hover:text-fg',
            )}
          >
            {active && (
              <span
                aria-hidden="true"
                className="absolute inset-y-1 left-0 w-0.5 rounded-r bg-accent"
              />
            )}
            <Icon className="size-5 shrink-0" />
            <span className="w-full truncate text-center leading-none">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
