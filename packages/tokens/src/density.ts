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
};

export const compact: DensityMetrics = {
  controlHeightSm: '1.5rem',
  controlHeightMd: '1.875rem',
  controlHeightLg: '2.25rem',
  controlPaddingX: '0.5rem',
  rowHeight: '1.5rem',
  stackGap: '0.5rem',
  controlFontSize: '0.8125rem',
};

export const densities: Record<DensityName, DensityMetrics> = { comfortable, compact };
