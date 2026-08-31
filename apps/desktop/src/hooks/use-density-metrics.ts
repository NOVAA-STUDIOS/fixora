import { densities } from '@fixora/tokens';
import { useMemo } from 'react';

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
 *
 * `rowHeight * 3` overshot: it priced every line at the single-line-control height, but the title
 * (13.5px/snug) and location (11px) lines in `FindingRow` are both shorter than that. Summing the
 * card's own padding/gap tokens plus each line's real height gets first paint close enough that
 * `dynamicRowHeight`'s measurement pass corrects a pixel drift instead of a visible reflow.
 */
export function useFindingRowEstimate(): number {
  const density = useUiStore((s) => s.density);
  const metrics = densities[density];
  const paddingY = remToPx(metrics.cardPaddingY) * 2;
  const gap = remToPx(metrics.cardGap);
  const actionsRow = remToPx(metrics.rowHeight); // Explain/Repair/Test buttons, full row height
  return useMemo(() => {
    // text-[13.5px] leading-snug / text-[11px] row (badge + path) — compact tightens both lines,
    // not just the card's own padding/gap, or the estimate overshoots at compact and the
    // virtualizer opens a gap below every row until its measurement pass corrects it.
    const titleLine = density === 'compact' ? 15 : 18;
    const wrapAllowance = 18; // long rule messages often wrap to a second title line
    const locationLine = density === 'compact' ? 13 : 16;
    const separator = 1; // border between cards
    const estimate = paddingY + gap + titleLine + wrapAllowance + locationLine + actionsRow + separator;
    // A floor, not just a sum of parts — a first-paint estimate that comes in too low is a row the
    // virtualizer positions on top of the one below it, until its own measurement pass corrects it.
    return Math.max(estimate, density === 'compact' ? 80 : 96);
  }, [paddingY, gap, actionsRow, density]);
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
