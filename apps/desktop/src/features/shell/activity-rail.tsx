import {
  AlertIcon,
  ClockIcon,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FolderIcon,
  GitBranchIcon,
  LightbulbIcon,
  PackageIcon,
  SearchIcon,
  SettingsIcon,
  SparkleIcon,
  TerminalIcon,
  cn,
} from '@fixora/ui';
import { useState } from 'react';

import { invoke } from '../../lib/bridge.js';
import { DAILY_LIMIT, useLicenseStore } from '../../stores/license-store.js';
import { useResetCountdown } from '../license/use-reset-countdown.js';
import { toast } from '../../stores/toast-store.js';
import { useUiStore, type ActivityView } from '../../stores/ui-store.js';
import { useAuthStore } from '../auth/auth-store.js';

const DOCS_URL = 'https://fixora-opal.vercel.app/docs';
const ISSUES_URL = 'https://github.com/NOVAA-STUDIOS/fixora/issues';

const PLAN_BADGE: Record<'free' | 'go' | 'pro', { label: string; color: string }> = {
  free: { label: 'FREE', color: 'bg-white/10 text-fg-muted' },
  go: { label: 'GO', color: 'bg-blue-400/15 text-blue-400' },
  pro: { label: 'PRO', color: 'bg-emerald-400/15 text-emerald-400' },
};

type RailItem = {
  view: ActivityView;
  label: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
};

const items: RailItem[] = [
  { view: 'workspace', label: 'Files', Icon: FolderIcon },
  { view: 'search', label: 'Search', Icon: SearchIcon },
  { view: 'findings', label: 'Problems', Icon: AlertIcon },
  { view: 'sourceControl', label: 'Source', Icon: GitBranchIcon },
  { view: 'history', label: 'History', Icon: ClockIcon },
  { view: 'packages', label: 'Packages', Icon: PackageIcon },
  { view: 'terminal', label: 'Terminal', Icon: TerminalIcon },
  { view: 'suggestions', label: 'Suggest', Icon: LightbulbIcon },
];
const SETTINGS_ITEM: RailItem = { view: 'settings', label: 'Settings', Icon: SettingsIcon };

/**
 * The activity rail (Design Review §5): the vertical strip that switches the primary view. Each item
 * carries a **visible label**, not just an icon — a rail of unlabelled glyphs is a guessing game for a
 * first-time user (and unusable by a screen reader). `aria-current` marks the active view, and the
 * active item gets an accent bar so "where am I" is answerable at a glance.
 */
export function ActivityRail(): React.JSX.Element {
  const activeView = useUiStore((s) => s.activeView);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const user = useAuthStore((s) => s.user);
  const setShowSignIn = useAuthStore((s) => s.setShowSignIn);
  const signOut = useAuthStore((s) => s.signOut);
  const plan = useLicenseStore((s) => s.plan);
  const setUpgradeDialogOpen = useLicenseStore((s) => s.setUpgradeDialogOpen);
  const repairsToday = useLicenseStore((s) => s.repairsToday);
  const [profileOpen, setProfileOpen] = useState(false);
  // A dead/unreachable avatar URL (network hiccup, revoked token) must fall back to the initials
  // circle, not a broken-image icon — `<img onError>` is the only way to know it failed to load.
  const [avatarFailed, setAvatarFailed] = useState(false);

  const displayName = (user?.user_metadata['full_name'] as string | undefined) ?? user?.email ?? '';
  const avatarUrl = user?.user_metadata['avatar_url'] as string | undefined;
  const showAvatar = avatarUrl !== undefined && !avatarFailed;
  const initial = displayName.charAt(0).toUpperCase() || '•';
  const dailyLimit = DAILY_LIMIT[plan];
  const resetCountdown = useResetCountdown();
  const usageLabel =
    dailyLimit === Infinity
      ? 'Unlimited'
      : `${String(repairsToday)} / ${String(dailyLimit)} repairs used${
          resetCountdown === null ? '' : ` · ${resetCountdown}`
        }`;
  const usagePct = dailyLimit === Infinity ? 0 : Math.min(100, (repairsToday / dailyLimit) * 100);

  const PLAN_META = {
    free: { label: 'Upgrade', color: 'text-amber-400' },
    go: { label: 'GO', color: 'text-blue-400' },
    pro: { label: 'Pro ✓', color: 'text-emerald-400' },
  } as const;
  const planMeta = PLAN_META[plan];

  return (
    <nav
      aria-label="Primary"
      // Sidebar spacing follows density too: compact tightens the gap between rail items so the
      // toggle affects the navigation as well as the content beside it.
      className="flex w-16 shrink-0 flex-col items-stretch gap-(--fx-sidebar-gap) border-r border-border-subtle bg-raised py-1"
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
              // iOS Premium: a rounded, inset pill — not Xcode's square full-bleed item — with a
              // filled background for the active state rather than a thin indicator bar.
              'group relative mx-1.5 flex flex-col items-center gap-1.5 rounded-xl px-1 text-[10px] font-medium',
              'py-(--fx-card-padding-y)',
              'transition-colors duration-(--fx-motion-duration-fast) ease-(--ease-entrance)',
              'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring focus-visible:outline',
              active ? 'bg-white/10 text-accent-text' : 'text-fg-muted hover:bg-hover hover:text-fg',
            )}
          >
            <Icon
              className={cn(
                'size-[18px] shrink-0 transition-transform duration-(--fx-motion-duration-fast) ease-(--ease-entrance)',
                !active && 'group-hover:scale-110',
              )}
            />
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
      <button
        type="button"
        aria-label={`Fixora ${planMeta.label}`}
        onClick={() => {
          setUpgradeDialogOpen(true);
        }}
        className={cn(
          'group mx-1.5 flex flex-col items-center gap-1.5 rounded-xl px-1 py-(--fx-card-padding-y) text-[10px] font-medium transition-colors duration-(--fx-motion-duration-fast) hover:bg-hover',
          planMeta.color,
        )}
      >
        <SparkleIcon className="size-[18px] shrink-0 transition-transform duration-(--fx-motion-duration-fast) group-hover:scale-110" />
        <span className="w-full truncate text-center leading-tight">{planMeta.label}</span>
      </button>
      {(() => {
        const { view, label, Icon } = SETTINGS_ITEM;
        const active = view === activeView;
        return (
          <button
            type="button"
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            onClick={() => {
              setActiveView(view);
            }}
            className={cn(
              'group relative mx-1.5 flex flex-col items-center gap-1.5 rounded-xl px-1 text-[10px] font-medium',
              'py-(--fx-card-padding-y)',
              'transition-colors duration-(--fx-motion-duration-fast) ease-(--ease-entrance)',
              'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring focus-visible:outline',
              active ? 'bg-white/10 text-accent-text' : 'text-fg-muted hover:bg-hover hover:text-fg',
            )}
          >
            <Icon
              className={cn(
                'size-[18px] shrink-0 transition-transform duration-(--fx-motion-duration-fast) ease-(--ease-entrance)',
                !active && 'group-hover:scale-110',
              )}
            />
            <span className="w-full truncate text-center leading-tight">{label}</span>
          </button>
        );
      })()}
      <div className="mt-auto">
        {user === null ? (
          <button
            type="button"
            title="Sign in"
            aria-label="Sign in"
            onClick={() => {
              setShowSignIn(true);
            }}
            className="group mx-1.5 flex flex-col items-center gap-1.5 rounded-xl px-1 py-(--fx-card-padding-y) text-[10px] font-medium text-fg-muted transition-colors duration-(--fx-motion-duration-fast) hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring focus-visible:outline"
          >
            <span
              aria-hidden="true"
              className="flex size-[18px] shrink-0 items-center justify-center rounded-full border border-current text-[9px] font-semibold"
            >
              ?
            </span>
            <span className="w-full truncate text-center leading-tight">Sign in</span>
          </button>
        ) : (
          // Radix's DropdownMenu already owns outside-click, Escape-to-close, and focus return
          // (WAI-ARIA menu pattern) — a hand-rolled mousedown listener would just re-implement
          // what this already does correctly, and every other menu in the app already uses it.
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title={displayName}
                aria-label="Account"
                className="group mx-1.5 flex flex-col items-center gap-1.5 rounded-xl px-1 py-(--fx-card-padding-y) text-[10px] font-medium text-fg-muted transition-colors duration-(--fx-motion-duration-fast) hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring focus-visible:outline"
              >
                {showAvatar ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    className="size-[18px] shrink-0 rounded-full object-cover"
                    onError={() => {
                      setAvatarFailed(true);
                    }}
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-accent text-[9px] font-semibold text-on-accent"
                  >
                    {initial}
                  </span>
                )}
                <span className="w-full truncate text-center leading-tight">Account</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-[260px] p-2">
              <div className="flex items-center gap-3 px-1 py-2">
                {showAvatar ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    className="size-10 shrink-0 rounded-full object-cover"
                    onError={() => {
                      setAvatarFailed(true);
                    }}
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-on-accent"
                  >
                    {initial}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">{displayName}</p>
                  <div className="flex items-center gap-1.5">
                    {user.email !== undefined && (
                      <p className="truncate text-xs text-fg-muted">{user.email}</p>
                    )}
                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold',
                        PLAN_BADGE[plan].color,
                      )}
                    >
                      {PLAN_BADGE[plan].label}
                    </span>
                  </div>
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  setProfileOpen(true);
                }}
              >
                👤 Profile
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  toast.success('Avatar synced from Google/GitHub account');
                }}
              >
                🖼️ Change avatar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5">
                <p className="text-xs text-fg-muted">📊 {usageLabel}</p>
                {dailyLimit !== Infinity && (
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${String(usagePct)}%` }}
                    />
                  </div>
                )}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  setActiveView('settings');
                }}
              >
                ⚙️ Settings
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void invoke('system:openExternal', { url: DOCS_URL });
                }}
              >
                📖 Documentation
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void invoke('system:openExternal', { url: ISSUES_URL });
                }}
              >
                🐛 Report a bug
              </DropdownMenuItem>
              {plan !== 'pro' && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      setUpgradeDialogOpen(true);
                    }}
                  >
                    ⚡ Upgrade
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                danger
                onSelect={() => {
                  void signOut();
                }}
              >
                🚪 Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {user !== null && (
        <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
          <DialogContent className="max-w-sm">
            <DialogTitle className="sr-only">Profile</DialogTitle>
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              {showAvatar ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className="size-16 shrink-0 rounded-full object-cover"
                  onError={() => {
                    setAvatarFailed(true);
                  }}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex size-16 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-semibold text-on-accent"
                >
                  {initial}
                </span>
              )}
              <div>
                <p className="text-base font-semibold text-fg">{displayName}</p>
                {user.email !== undefined && (
                  <p className="text-sm text-fg-muted">{user.email}</p>
                )}
              </div>
              <span
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-semibold',
                  PLAN_BADGE[plan].color,
                )}
              >
                {PLAN_BADGE[plan].label}
              </span>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </nav>
  );
}
