/**
 * Raw scales. **Components never reference these** (Design Review §6.2) — they reference the
 * semantic aliases in `semantic.ts`, which are the things the contrast gate actually checks.
 *
 * One accent (violet, ADR-026). One 12-step neutral ramp, violet-tinted so the near-black
 * canvas and the accent belong to the same family rather than reading as grey-plus-purple.
 * Status hues are held separate and are never used decoratively.
 */

export type Scale = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

/** Dark is the primary theme: it is where our audience already lives (Design Review §1). */
export const neutralDark: Scale = [
  '#08070b',
  '#0b0a0f',
  '#141221',
  '#1a1728',
  '#211d30',
  '#292437',
  '#332d44',
  '#433c58',
  '#6f6689',
  '#8b82a6',
  '#a9a1c0',
  '#f4f2f8',
];

export const neutralLight: Scale = [
  '#ffffff',
  '#faf9fc',
  '#f4f2f8',
  '#edeaf4',
  '#e5e1ee',
  '#dbd6e6',
  '#cec7dd',
  '#b8afcc',
  '#8b82a6',
  '#6a6386',
  '#524c6b',
  '#17141f',
];

/**
 * Steps 8 and 9 are the interactive pair (solid, hover) and they are *tuned*, not picked.
 * On a near-black canvas a solid must sit in a luminance window of roughly [0.110, 0.183]:
 * below it the button is invisible against the canvas (< 3:1), above it the white label
 * inside the button is unreadable (< 4.5:1). That window is 0.07 wide, which is why the
 * obvious violet-500 (#8b5cf6, L = 0.198) is *not* here — it fails the label test at 4.23:1.
 * This is exactly the trade ADR-026 accepted, priced by the gate rather than by eye.
 */
export const violetDark: Scale = [
  '#120e1f',
  '#170f2b',
  '#221142',
  '#2c1656',
  '#351c67',
  '#402479',
  '#4f2e95',
  '#6039bd',
  '#7c3aed',
  '#8a4ae8',
  '#b9a4ff',
  '#ede6ff',
];

export const violetLight: Scale = [
  '#fcfaff',
  '#f7f2ff',
  '#f0e8ff',
  '#e6d9ff',
  '#dac8ff',
  '#cbb4fb',
  '#b89bf2',
  '#9f79e8',
  '#7c3aed',
  '#6d28d9',
  '#5b21b6',
  '#2e1065',
];

/**
 * Status hues. Each `solid` is squeezed from both sides at once — visible against the canvas
 * (≥ 3:1) *and* able to carry a readable label (≥ 4.5:1) — so each one carries its own
 * `onSolid` rather than assuming white.
 *
 * `warn` is the honest casualty of that squeeze: no amber that still reads as amber fits the
 * white-label window (#f5a524 gives white a hopeless 2.04:1). So the amber stays amber and
 * the label goes dark, which is what every palette that has actually run these numbers does.
 * Forcing white onto it would mean either a brown "amber" or an unreadable badge.
 */
export const statusDark = {
  danger: {
    solid: '#d92d3a',
    onSolid: '#ffffff',
    text: '#ff9592',
    subtle: '#2a1315',
    border: '#7a2226',
  },
  warn: {
    solid: '#f5a524',
    onSolid: '#1a1206',
    text: '#ffcb62',
    subtle: '#2a1e0c',
    border: '#7d5312',
  },
  success: {
    solid: '#1a7f4f',
    onSolid: '#ffffff',
    text: '#4cc38a',
    subtle: '#0e2119',
    border: '#1c5138',
  },
  info: {
    solid: '#2f6fe0',
    onSolid: '#ffffff',
    text: '#8ab8ff',
    subtle: '#0e1a2e',
    border: '#1e4079',
  },
} as const;

export const statusLight = {
  danger: {
    solid: '#dc2626',
    onSolid: '#ffffff',
    text: '#b91c1c',
    subtle: '#fef2f2',
    border: '#fca5a5',
  },
  warn: {
    solid: '#b45309',
    onSolid: '#ffffff',
    text: '#92400e',
    subtle: '#fffbeb',
    border: '#fcd34d',
  },
  success: {
    solid: '#15803d',
    onSolid: '#ffffff',
    text: '#166534',
    subtle: '#f0fdf4',
    border: '#86efac',
  },
  info: {
    solid: '#1d4ed8',
    onSolid: '#ffffff',
    text: '#1e40af',
    subtle: '#eff6ff',
    border: '#93c5fd',
  },
} as const;

export type StatusName = keyof typeof statusDark;
export const statusNames = ['danger', 'warn', 'success', 'info'] as const;
