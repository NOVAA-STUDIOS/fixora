import { FixoraMark } from '@fixora/ui';

/**
 * The launch splash. It covers the real work of starting up — restoring the last workspace and
 * listing its root — rather than padding the launch with a fake delay: `App` hides it as soon as
 * hydration settles, with only a short floor so it reads as a deliberate transition instead of a
 * flash.
 *
 * It sits inside the renderer rather than in a second BrowserWindow. A splash window would mean
 * another window to secure, position and tear down, for a moment of branding — the window itself is
 * already held back until `ready-to-show`, so this is the first thing painted either way.
 *
 * Every animation here is wrapped in `motion-safe:`, so a user who asked their OS to reduce motion
 * gets the same screen, composed and still.
 */
export function SplashScreen({ leaving }: { leaving: boolean }): React.JSX.Element {
  return (
    <div
      // aria-hidden: this is a branded loading state, and the app announces itself properly once the
      // workbench mounts. A screen-reader user gets the busy state from `aria-busy` on the root.
      aria-hidden="true"
      className={[
        'fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-canvas',
        'transition-opacity duration-300 ease-out',
        leaving ? 'pointer-events-none opacity-0' : 'opacity-100',
      ].join(' ')}
    >
      <div className="motion-safe:animate-[fx-splash-in_420ms_ease-out_both] flex flex-col items-center gap-4">
        <FixoraMark className="size-16 drop-shadow-lg" title="Fixora" />
        <div className="flex flex-col items-center gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Fixora</h1>
          <p className="text-sm text-fg-muted">Fix smarter. Ship faster.</p>
        </div>
      </div>

      {/* An indeterminate sweep, not a percentage: we do not know how long restoring a workspace
          takes, and a progress bar that lies is worse than one that only says "working". */}
      <div className="h-0.5 w-40 overflow-hidden rounded-full bg-border-subtle">
        <div className="motion-safe:animate-[fx-splash-sweep_1.4s_ease-in-out_infinite] h-full w-1/3 rounded-full bg-accent" />
      </div>
    </div>
  );
}
