/**
 * Density (Design Review §6.6): "the app must ship a compact/comfortable toggle. Developers on
 * 1080p laptops will not tolerate a spacious-only IDE."
 *
 * Density is a *control-metric* token, not a colour, so it is theme-independent and it is
 * switched exactly like the theme — a single `data-density` attribute on the root flips every
 * variable at once (`:root[data-density='compact']`). Because it is CSS-variable-driven, the
 * switch is instant and involves no React re-render: the acceptance criterion "density switch
 * instantly with no layout shift" is a property of the mechanism, not something each component
 * has to remember to honour.
 *
 * Comfortable is the default (emitted on `:root`); compact is the override. Components read
 * these variables (`var(--fx-control-h-md)`), never the raw numbers — the same discipline that
 * keeps colour on the semantic layer.
 */

export type DensityMetrics = {
  /** Control heights (buttons, inputs, select triggers) at three sizes. */
  controlHeightSm: string;
  controlHeightMd: string;
  controlHeightLg: string;
  /** Horizontal padding inside a control. */
  controlPaddingX: string;
  /** The height of a row in a list/tree/table — the number that decides how much fits on screen. */
  rowHeight: string;
  /** Default gap between stacked controls. */
  stackGap: string;
  /** Font size for control labels, so text scales with the control at compact. */
  controlFontSize: string;
  /**
   * Vertical padding inside a list CARD — a problem row, a history entry.
   *
   * Distinct from `rowHeight`, which sizes a single-line row. A card is a stack (title, location,
   * actions), so its density comes from its own padding and internal gap rather than from a fixed
   * height it would overflow. Without these, cards kept comfortable spacing at every density and the
   * toggle visibly changed the chrome around the list while doing nothing to the list itself.
   */
  cardPaddingY: string;
  cardPaddingX: string;
  /** Gap between the stacked parts of a card (title → location → actions). */
  cardGap: string;
  /** Gap between items in a sidebar/nav list. */
  sidebarGap: string;
  /** Status bar height. Trimmed at compact, where every row of vertical space is contested. */
  statusBarHeight: string;
};

export type DensityName = 'comfortable' | 'compact';

export const comfortable: DensityMetrics = {
  controlHeightSm: '1.75rem',
  controlHeightMd: '2.25rem',
  controlHeightLg: '2.75rem',
  controlPaddingX: '0.75rem',
  rowHeight: '2rem',
  stackGap: '0.75rem',
  controlFontSize: '0.875rem',
  cardPaddingY: '0.5rem',
  cardPaddingX: '0.75rem',
  cardGap: '0.375rem',
  sidebarGap: '0.25rem',
  statusBarHeight: '1.75rem',
};

export const compact: DensityMetrics = {
  controlHeightSm: '1.5rem',
  controlHeightMd: '1.875rem',
  controlHeightLg: '2.25rem',
  controlPaddingX: '0.5rem',
  rowHeight: '1.5rem',
  stackGap: '0.5rem',
  controlFontSize: '0.8125rem',
  // 28.6% less vertical space per card than comfortable: padding 0.5→0.375, gap 0.375→0.25, so the
  // non-content height of a three-part card falls from 1.75rem to 1.25rem. Deliberately mid-band
  // rather than as tight as possible — past roughly a third, rows stop reading as separate cards and
  // the list becomes a wall of text, which costs more scanning time than the space saves.
  cardPaddingY: '0.375rem',
  cardPaddingX: '0.625rem',
  cardGap: '0.25rem',
  sidebarGap: '0.125rem',
  statusBarHeight: '1.5rem',
};

export const densities: Record<DensityName, DensityMetrics> = { comfortable, compact };
