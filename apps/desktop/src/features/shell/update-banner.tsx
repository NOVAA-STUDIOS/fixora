/**
 * Auto-update: the downloading moment shows nothing — a slow network can't be fixed by a progress
 * bar, and narrating it just gives the user something to watch and worry about. "Ready to
 * restart" is the only decision point, and it already has its own surface: the status bar's
 * update pill (`status-bar.tsx`'s `UpdateReadyPill`) plus its modal.
 */
export function UpdateBanner(): React.JSX.Element | null {
  return null;
}
