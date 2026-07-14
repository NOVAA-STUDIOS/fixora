import type { AppInfo } from '@fixora/shared-types';

import { useAppInfo } from '../hooks/use-app-info.js';
import { useTheme } from '../hooks/use-theme.js';

/**
 * M0's renderer is deliberately almost nothing. It exists to demonstrate two things that must
 * be true before any product surface is built on top of them:
 *
 *   1. the typed IPC round-trip works and returns a `Result`, not a thrown string;
 *   2. the token layer themes the app in light and dark with no layout shift.
 *
 * The design system, the app shell and the command registry are M1. Building them here would
 * be building them before the primitives they need exist.
 *
 * The component is presentational (Standards §3): it reads state from hooks and renders it. It
 * does no fetching of its own — that lives in `useAppInfo`.
 */
export function App(): React.JSX.Element {
  const { theme, toggle } = useTheme();
  const appInfo = useAppInfo();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-6 text-fg">
      <header className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Fixora</h1>
        <p className="text-fg-muted">Fix smarter. Ship faster.</p>
      </header>

      <section
        aria-label="Shell diagnostics"
        className="w-full max-w-md rounded-lg border border-border-subtle bg-raised p-5 shadow-md"
      >
        <h2 className="mb-3 text-sm font-medium text-fg-secondary">Shell status</h2>

        {appInfo.status === 'error' && (
          <p role="alert" className="text-sm text-danger-text">
            {appInfo.error.message}{' '}
            <span className="text-fg-muted">({appInfo.error.action.label})</span>
          </p>
        )}

        {appInfo.status === 'loading' && (
          <p className="text-sm text-fg-muted">Asking the main process who it is…</p>
        )}

        {appInfo.status === 'ready' && <AppInfoTable info={appInfo.info} />}
      </section>

      <button
        type="button"
        onClick={toggle}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-(--fx-motion-duration-fast) ease-(--ease-entrance) hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        Switch to {theme === 'dark' ? 'light' : 'dark'} theme
      </button>
    </main>
  );
}

function AppInfoTable({ info }: { info: AppInfo }): React.JSX.Element {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 font-mono text-sm">
      <Row label="version" value={info.version} />
      <Row label="electron" value={info.electronVersion} />
      <Row label="platform" value={`${info.platform}/${info.arch}`} />
      <Row label="packaged" value={String(info.isPackaged)} />
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-fg">{value}</dd>
    </>
  );
}
