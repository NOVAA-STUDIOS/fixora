import {
  indigoRamp,
  iosGlassLight,
  neutralLight,
  statusDark,
  statusLight,
  type StatusName,
} from './primitives.js';

/**
 * The semantic layer. This is the only colour surface a component is allowed to touch, and
 * every pair in it that a human has to *read* is checked by the contrast gate before it can
 * enter the palette.
 */
export type SemanticColors = {
  bg: {
    canvas: string;
    raised: string;
    inset: string;
    overlay: string;
    hover: string;
    active: string;
    /** iOS "material": a translucent surface, only meaningful paired with `backdrop-blur`. */
    glass: string;
    /** A more opaque glass variant — content sitting ON a glass surface, not the surface itself. */
    glassSurface: string;
  };
  text: {
    primary: string;
    secondary: string;
    muted: string;
    /** Text drawn on top of `accent.solid`. */
    onAccent: string;
  };
  border: {
    /** Decorative separation (dividers, card edges). Deliberately below 3:1; not a control boundary. */
    subtle: string;
    /**
     * The resting border of an input or card. Below 3:1 by design — a resting border that
     * clears 3:1 reads as heavy. WCAG 1.4.11 governs the boundary *required to identify* a
     * control, which a filled/labelled input does not depend on; that boundary is `strong`.
     */
    default: string;
    /** The identifying control boundary — focus/active/error, and outline-only controls. Gated at 3:1. */
    strong: string;
  };
  accent: {
    solid: string;
    solidHover: string;
    solidActive: string;
    subtle: string;
    border: string;
    /** Violet used as *text* on a surface. The one violet a contrast gate really argues with. */
    text: string;
  };
  focus: {
    /**
     * The ring is rendered with a *transparent* 2px offset (`outline-offset`), so the colour
     * adjacent to the ring is whatever surface the focused control sits on — never the control
     * itself. That is what lets a single ring colour clear 3:1 against both, which a ring drawn
     * flush against the control cannot do (see `requirements.ts`). There is deliberately no
     * offset *colour* token: the offset shows through to the surface, it is not painted.
     */
    ring: string;
  };
  status: Record<
    StatusName,
    { solid: string; onSolid: string; text: string; subtle: string; border: string }
  >;
};

// REDESIGN: Xcode DNA — flat matte surfaces (not the near-black violet-tinted ramp above) and
// Xcode's own blue accent, not the iOS indigo the redesign used before this. `neutralDark` stays
// defined and used elsewhere (it still backs `violetDark`'s tint derivation); this theme simply
// stops reading from it for bg/border, in favour of literal Xcode hex.
// REDESIGN: iOS Premium — restores glass, deepens the canvas, and moves borders/hover/active to
// translucent white overlays (the iOS "materials" approach) instead of opaque greys.
export const dark: SemanticColors = {
  bg: {
    canvas: '#000000',
    raised: '#0a0a0a',
    inset: '#000000',
    overlay: '#111111',
    hover: 'rgba(255, 255, 255, 0.05)',
    active: 'rgba(255, 255, 255, 0.08)',
    // Solid, not translucent: backdrop-filter (which made these worth being translucent) is gone —
    // it caused GPU-process freezes in Electron. Kept as the exact colour the blur used to sit on.
    glass: '#0a0a0a',
    glassSurface: '#111111',
  },
  text: {
    primary: '#ffffff',
    secondary: '#aeaeb2',
    muted: '#8e8e93',
    onAccent: '#ffffff',
  },
  border: {
    subtle: 'rgba(255, 255, 255, 0.06)',
    default: 'rgba(255, 255, 255, 0.09)',
    // Opaque, not translucent like `subtle`/`default`: the contrast gate parses only 6-digit hex
    // (`parseHex` in `contrast.ts`), and this is the one border field it actually audits (the
    // control-identifying boundary, per WCAG 1.4.11) — an rgba value here crashes the gate rather
    // than being silently unchecked. Chosen to read the same as `rgba(255,255,255,0.18)` composited
    // over `bg.raised`.
    strong: '#666672',
  },
  accent: {
    solid: '#2870c4',
    solidHover: '#2570cc',
    solidActive: '#1e63bf',
    subtle: 'rgba(40, 112, 196, 0.15)',
    border: 'rgba(40, 112, 196, 0.35)',
    text: '#5ea3f5',
  },
  focus: {
    ring: '#5ea3f5',
  },
  status: statusDark,
};

export const light: SemanticColors = {
  bg: {
    canvas: neutralLight[1],
    raised: neutralLight[0],
    inset: neutralLight[2],
    overlay: neutralLight[0],
    hover: neutralLight[3],
    active: neutralLight[4],
    glass: iosGlassLight,
    glassSurface: 'rgba(255, 255, 255, 0.85)',
  },
  text: {
    primary: neutralLight[11],
    secondary: neutralLight[10],
    muted: neutralLight[9],
    onAccent: '#ffffff',
  },
  border: {
    subtle: neutralLight[4],
    default: neutralLight[6],
    // Step 7 (#b8afcc) is the one that *looks* right and fails at 1.99:1. Step 8 clears 3:1.
    strong: neutralLight[8],
  },
  accent: {
    solid: indigoRamp[600],
    solidHover: indigoRamp[700],
    solidActive: indigoRamp[800],
    subtle: 'rgba(88, 86, 214, 0.1)',
    border: 'rgba(88, 86, 214, 0.35)',
    text: indigoRamp[600],
  },
  focus: {
    ring: indigoRamp[600],
  },
  status: statusLight,
};

export type ThemeName = 'light' | 'dark';

export const themes: Record<ThemeName, SemanticColors> = { light, dark };
