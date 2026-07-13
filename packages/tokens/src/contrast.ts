/**
 * WCAG 2.2 contrast maths. Small enough to own, important enough not to outsource:
 * this function is the arbiter of what colour is allowed to enter the palette
 * (Design Review §6.3), so it gets its own tests against the published reference pairs.
 */

export type Rgb = { r: number; g: number; b: number };

const HEX_PATTERN = /^#([0-9a-f]{6})$/i;

/** Parses `#rrggbb`. Throws on anything else — a malformed token is a bug, not a condition. */
export function parseHex(hex: string): Rgb {
  const digits = HEX_PATTERN.exec(hex)?.[1];
  if (digits === undefined) {
    throw new Error(`Not a 6-digit hex colour: ${hex}`);
  }

  const value = Number.parseInt(digits, 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

/** sRGB → linear, per WCAG 2.x. */
function toLinear(channel8Bit: number): number {
  const c = channel8Bit / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Contrast ratio in [1, 21]. Order-independent, as WCAG defines it. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Rounded down, so a 4.499 never reports as a passing 4.5. */
export function contrastRatioFloor(foreground: string, background: string, digits = 2): number {
  const factor = 10 ** digits;
  return Math.floor(contrastRatio(foreground, background) * factor) / factor;
}
