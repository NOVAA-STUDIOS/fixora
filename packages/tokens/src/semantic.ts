import {
  neutralDark,
  neutralLight,
  statusDark,
  statusLight,
  violetDark,
  violetLight,
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
  };
  text: {
    primary: string;
    secondary: string;
    muted: string;
    /** Text drawn on top of `accent.solid`. */
    onAccent: string;
  };
  border: {
    /** Decorative separation only. Deliberately below 3:1 — see `requirements.ts`. */
    subtle: string;
    /** The boundary of an interactive control. Contrast-checked at 3:1. */
    default: string;
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
     * The ring is rendered with a 2px offset, so the colour adjacent to it is the surface,
     * never the control. The offset is part of the contract, not a style preference.
     */
    ring: string;
    offset: string;
  };
  status: Record<
    StatusName,
    { solid: string; onSolid: string; text: string; subtle: string; border: string }
  >;
};

export const dark: SemanticColors = {
  bg: {
    canvas: neutralDark[1],
    raised: neutralDark[2],
    inset: neutralDark[0],
    overlay: neutralDark[3],
    hover: neutralDark[4],
    active: neutralDark[5],
  },
  text: {
    primary: neutralDark[11],
    secondary: neutralDark[10],
    muted: neutralDark[9],
    onAccent: '#ffffff',
  },
  border: {
    subtle: neutralDark[5],
    default: neutralDark[7],
    strong: neutralDark[8],
  },
  accent: {
    solid: violetDark[8],
    solidHover: violetDark[9],
    solidActive: violetDark[7],
    subtle: violetDark[2],
    border: violetDark[6],
    text: violetDark[10],
  },
  focus: {
    ring: violetDark[10],
    offset: neutralDark[1],
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
    solid: violetLight[9],
    solidHover: violetLight[10],
    solidActive: violetLight[11],
    subtle: violetLight[2],
    border: violetLight[5],
    text: violetLight[10],
  },
  focus: {
    ring: violetLight[9],
    offset: neutralLight[1],
  },
  status: statusLight,
};

export type ThemeName = 'light' | 'dark';

export const themes: Record<ThemeName, SemanticColors> = { light, dark };
