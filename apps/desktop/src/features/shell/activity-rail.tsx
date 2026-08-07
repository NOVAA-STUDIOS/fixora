import {
  AlertIcon,
  ClockIcon,
  FolderIcon,
  LightbulbIcon,
  PackageIcon,
  SearchIcon,
  SettingsIcon,
  TerminalIcon,
  cn,
} from '@fixora/ui';

import { useUiStore, type ActivityView } from '../../stores/ui-store.js';

type RailItem = {
  view: ActivityView;
  label: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
};

const items: RailItem[] = [
  { view: 'workspace', label: 'Files', Icon: FolderIcon },
  { view: 'search', label: 'Search', Icon: SearchIcon },
  { view: 'findings', label: 'Problems', Icon: AlertIcon },
  { view: 'history', label: 'History', Icon: ClockIcon },
  { view: 'packages', label: 'Packages', Icon: PackageIcon },
  { view: 'terminal', label: 'Terminal', Icon: TerminalIcon },
  { view: 'suggestions', label: 'Suggest', Icon: LightbulbIcon },
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
      // Sidebar spacing follows density too: compact tightens the gap between rail items so the
      // toggle affects the navigation as well as the content beside it.
      className="flex w-16 shrink-0 flex-col items-stretch gap-(--fx-sidebar-gap) py-1"
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
              // A rounded target inset from the rail edges, rather than a full-bleed strip. The rail
              // sits on the chrome layer now, so an item that lights up edge-to-edge reads as a
              // background change; a pill reads as a thing you pressed.
              'relative mx-1.5 flex flex-col items-center gap-1.5 rounded-lg px-1 text-[10px] font-medium',
              // Vertical padding from the card token, so a rail item tightens with everything else.
              'py-(--fx-card-padding-y)',
              // Every other interactive surface in the app animates its hover; the rail — the most
              // frequently clicked thing in the window — snapped between states instantly.
              'transition-colors duration-(--fx-motion-duration-fast) ease-(--ease-entrance)',
              'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring focus-visible:outline',
              active
                ? 'bg-accent-subtle text-accent-text'
                : 'text-fg-muted hover:bg-hover hover:text-fg',
            )}
          >
            <Icon className="size-5 shrink-0" />
            {/*
              leading-none (line-height: 1) left no buffer above a glyph's descender — invisible
              for every label until "Suggest" (F1) added the rail's first descender (the two "g"s),
              which then rendered visibly clipped at the bottom. Worse under Windows' fractional
              display scaling (125%/150%), where sub-pixel rounding shaves into an already-exact-fit
              line box. leading-tight (1.25, the same ratio as --fx-leading-tight) gives every
              descender room without visibly growing the row — the label box is unconstrained by any
              ancestor height, so it grows to fit rather than clipping.
            */}
            <span className="w-full truncate text-center leading-tight">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
