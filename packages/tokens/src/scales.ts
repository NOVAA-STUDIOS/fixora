/**
 * The non-colour tokens: type, space, radius, motion, elevation, z-index.
 * Theme-independent — only colour changes between light and dark.
 */

/**
 * Inter for UI, JetBrains Mono for code — the same monospace the editor and the website's
 * code blocks use, so the brand is consistent down to the glyph (Design Review §6.5).
 */
export const fontFamily = {
  sans: "Inter, 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'Cascadia Code', 'Consolas', ui-monospace, monospace",
} as const;

export const fontSize = {
  xs: '0.75rem',
  sm: '0.8125rem',
  base: '0.875rem',
  md: '1rem',
  lg: '1.125rem',
  xl: '1.375rem',
  '2xl': '1.75rem',
  '3xl': '2.25rem',
} as const;

export const fontWeight = {
  normal: '400',
  medium: '500',
  semibold: '600',
} as const;

export const lineHeight = {
  tight: '1.25',
  normal: '1.5',
  relaxed: '1.7',
} as const;

/** 4px base grid. */
export const space = {
  0: '0',
  1: '0.25rem',
  2: '0.5rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  8: '2rem',
  10: '2.5rem',
  12: '3rem',
  16: '4rem',
} as const;

export const radius = {
  none: '0',
  sm: '0.25rem',
  md: '0.375rem',
  lg: '0.5rem',
  xl: '0.75rem',
  full: '9999px',
} as const;

/**
 * "120–200ms, one easing curve for entrances, one for exits. No animation over 300ms in the
 * app shell" (Design Review §6.4). All of it disabled under `prefers-reduced-motion`, which
 * the emitted CSS enforces rather than leaving to each component to remember.
 */
export const motion = {
  durationInstant: '80ms',
  durationFast: '120ms',
  durationNormal: '160ms',
  durationSlow: '200ms',
  easeEntrance: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  easeExit: 'cubic-bezier(0.4, 0, 1, 1)',
} as const;

export const elevation = {
  none: 'none',
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.24)',
  md: '0 4px 12px -2px rgb(0 0 0 / 0.32)',
  lg: '0 16px 40px -8px rgb(0 0 0 / 0.44)',
} as const;

export const zIndex = {
  base: '0',
  raised: '10',
  sticky: '100',
  overlay: '200',
  dialog: '300',
  popover: '400',
  toast: '500',
} as const;

/** The focus ring offset is a contract, not a preference. See `requirements.ts`. */
export const focus = {
  ringWidth: '2px',
  ringOffsetWidth: '2px',
} as const;
