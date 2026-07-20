import { densities } from '@fixora/tokens';

import { useUiStore } from '../stores/ui-store.js';

/**
 * The density row height, in pixels, for the virtualised lists.
 *
 * Almost everything honours density for free, because density is CSS variables and the switch is a
 * single attribute on the root (see `use-appearance.ts`). Virtualised lists are the exception: the
 * virtualizer positions rows from a JS number, so a hardcoded stride left the file tree and the
 * problems list at comfortable spacing forever — the toggle visibly changed the chrome around them
 * and did nothing to the two surfaces that hold the most rows.
 *
 * The number still comes from the tokens (`densities[...].rowHeight`), never from a literal here,
 * so the lists and the CSS cannot drift apart.
 */
export function useRowHeight(): number {
  const density = useUiStore((s) => s.density);
  return remToPx(densities[density].rowHeight);
}

/**
 * The problems list's row height. A finding row is a stack — message, location line, actions — so it
 * is a multiple of the base row rather than a second token: it must move *with* density, but it was
 * never one row tall. The virtualizer measures the real rows (`dynamicRowHeight`); this is only the
 * first-paint estimate, which is why an approximation is honest here.
 */
export function useFindingRowEstimate(): number {
  return useRowHeight() * 3;
}

/**
 * Tokens are authored in `rem` (ADR-030) and the virtualizer needs px. This reads the document's
 * actual root font size rather than assuming 16, so a user who has raised it in the OS gets rows
 * that match the text inside them instead of rows the text overflows.
 */
function remToPx(rem: string): number {
  const value = Number.parseFloat(rem);
  if (!Number.isFinite(value)) return 32;
  const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Math.round(value * (Number.isFinite(root) && root > 0 ? root : 16));
}
