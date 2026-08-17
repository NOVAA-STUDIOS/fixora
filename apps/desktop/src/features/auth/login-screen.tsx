import { MinimalTitleBar } from '../shell/minimal-title-bar.js';

import { useAuthStore } from './auth-store.js';

/** An optional overlay over the already-running app — sign-in is only needed for repair and
 * purchase, never a hard gate in front of the whole workbench. Dismissible with "Not now". */
export function LoginScreen(): React.JSX.Element {
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const signInWithGitHub = useAuthStore((s) => s.signInWithGitHub);
  const error = useAuthStore((s) => s.error);
  const setShowSignIn = useAuthStore((s) => s.setShowSignIn);

  return (
    <div className="fixed inset-0 z-50 flex h-full w-full flex-col items-center justify-center gap-10 bg-[#000000] px-6 text-center">
      <MinimalTitleBar />
      <div className="flex flex-col items-center gap-3">
        <span className="text-2xl font-semibold tracking-tight text-white">Fixora</span>
        <p className="max-w-xs text-sm text-white/50">
          The workspace you open when the code is already broken.
        </p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        <button
          type="button"
          onClick={() => void signInWithGoogle()}
          className="flex items-center justify-center gap-3 rounded-[980px] bg-white px-6 py-3 text-sm font-medium text-black transition-opacity hover:opacity-90"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.87 2.7-6.62z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.81.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18z"
            />
            <path
              fill="#FBBC05"
              d="M3.95 10.7A5.4 5.4 0 0 1 3.66 9c0-.59.1-1.17.29-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58z"
            />
          </svg>
          Continue with Google
        </button>

        <button
          type="button"
          onClick={() => void signInWithGitHub()}
          className="flex items-center justify-center gap-3 rounded-[980px] border border-white/15 bg-transparent px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.06]"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Continue with GitHub
        </button>

        {error !== null && <p className="text-sm text-[#ef4444]">{error}</p>}

        <button
          type="button"
          onClick={() => setShowSignIn(false)}
          className="text-sm text-white/40 hover:text-white/70"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
