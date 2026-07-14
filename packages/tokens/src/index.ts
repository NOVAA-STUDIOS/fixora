export {
  contrastRatio,
  contrastRatioFloor,
  parseHex,
  relativeLuminance,
  type Rgb,
} from './contrast.js';
export {
  comfortable,
  compact,
  densities,
  type DensityMetrics,
  type DensityName,
} from './density.js';
export { statusNames, type StatusName } from './primitives.js';
export {
  auditAllThemes,
  auditTheme,
  type ContrastRequirement,
  type ContrastResult,
} from './requirements.js';
export {
  elevation,
  focus,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  motion,
  radius,
  space,
  zIndex,
} from './scales.js';
export { dark, light, themes, type SemanticColors, type ThemeName } from './semantic.js';

// NOTE: the raw colour ramps (neutralDark, violetLight, statusDark, ...) and the `Scale` type
// are deliberately NOT re-exported. They are the primitives the semantic layer is built from,
// and a component that reaches past `dark`/`light` into a raw ramp has bypassed the contrast
// gate — the exact thing the gate exists to prevent (Design Review §6.2). Keeping them out of
// the public barrel makes that bypass a module-resolution error instead of a code review that
// someone has to catch. Internal code imports them from `./primitives.js` directly.
