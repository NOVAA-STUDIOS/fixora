import { contrastRatioFloor } from './contrast.js';
import { statusNames } from './primitives.js';
import { themes, type SemanticColors, type ThemeName } from './semantic.js';

/**
 * The contrast contract.
 *
 * "Every token gets contrast-tested before it enters the palette, no exceptions"
 * (Design Review §2.4). This file is what "no exceptions" means in practice: a pair that is
 * not listed here is a pair nobody has thought about, so the audit also asserts that every
 * `text.*` alias appears against every surface it can be drawn on.
 *
 * WCAG 2.2 AA: body text 4.5:1, large text and non-text UI boundaries 3:1.
 */

export type ContrastRequirement = {
  readonly id: string;
  readonly foreground: string;
  readonly background: string;
  readonly minRatio: number;
  readonly why: string;
};

export type ContrastResult = ContrastRequirement & {
  readonly theme: ThemeName;
  readonly fgHex: string;
  readonly bgHex: string;
  readonly ratio: number;
  readonly passed: boolean;
};

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

/** Surfaces that body text can legitimately be drawn on. */
const READABLE_SURFACES = ['canvas', 'raised', 'overlay'] as const;

function requirementsFor(c: SemanticColors): ContrastRequirement[] {
  const reqs: ContrastRequirement[] = [];

  for (const surface of READABLE_SURFACES) {
    const bg = c.bg[surface];

    for (const role of ['primary', 'secondary', 'muted'] as const) {
      reqs.push({
        id: `text.${role} on bg.${surface}`,
        foreground: c.text[role],
        background: bg,
        minRatio: AA_TEXT,
        why: 'Body text. Under 4.5:1 it is unreadable for a large number of real people.',
      });
    }

    reqs.push({
      id: `accent.text on bg.${surface}`,
      foreground: c.accent.text,
      background: bg,
      minRatio: AA_TEXT,
      why: 'ADR-026 accepts that violet-as-text is the hard case. This is where we prove it.',
    });

    reqs.push({
      id: `border.strong on bg.${surface}`,
      foreground: c.border.strong,
      background: bg,
      minRatio: AA_NON_TEXT,
      why:
        'The boundary that *identifies* a control (WCAG 2.2 1.4.11), used for focus/active/error ' +
        'states and for controls that rely on their outline to be found. 1.4.11 governs the ' +
        'information "required to identify" a component, which is this one. `border.default` and ' +
        '`border.subtle` are resting/decorative separators — a control identifiable by its fill, ' +
        'label or placeholder does not depend on them, so they are intentionally below 3:1 (a ' +
        'resting border that clears 3:1 is a heavy border, and would fight the calm aesthetic).',
    });

    reqs.push({
      id: `accent.solid on bg.${surface}`,
      foreground: c.accent.solid,
      background: bg,
      minRatio: AA_NON_TEXT,
      why: 'The primary button must be distinguishable from the surface it sits on.',
    });

    for (const status of statusNames) {
      reqs.push({
        id: `status.${status}.text on bg.${surface}`,
        foreground: c.status[status].text,
        background: bg,
        minRatio: AA_TEXT,
        why: 'A severity label a user has to read. A finding they cannot read is a finding we did not report.',
      });
      reqs.push({
        id: `status.${status}.solid on bg.${surface}`,
        foreground: c.status[status].solid,
        background: bg,
        minRatio: AA_NON_TEXT,
        why: 'Severity is carried by a badge; the badge must be visible against its surface.',
      });
    }
  }

  reqs.push({
    id: 'text.onAccent on accent.solid',
    foreground: c.text.onAccent,
    background: c.accent.solid,
    minRatio: AA_TEXT,
    why: 'The label inside the primary button.',
  });

  for (const state of ['solidHover', 'solidActive'] as const) {
    reqs.push({
      id: `text.onAccent on accent.${state}`,
      foreground: c.text.onAccent,
      background: c.accent[state],
      minRatio: AA_TEXT,
      why: 'A button whose label vanishes on hover is a button that fails on interaction, which is the moment it matters most.',
    });
  }

  for (const status of statusNames) {
    reqs.push({
      id: `status.${status}.onSolid on status.${status}.solid`,
      foreground: c.status[status].onSolid,
      background: c.status[status].solid,
      minRatio: AA_TEXT,
      why: 'The label inside a severity badge. A severity a user cannot read is a severity we did not communicate.',
    });
  }

  /**
   * The focus ring is checked against the *surface*, not against the control, because it is
   * drawn with a 2px offset (`--fx-focus-ring-offset-width`), so the colour adjacent to the
   * ring is the surface.
   *
   * This is a deliberate, load-bearing deviation from the Design Review's phrasing ("≥3:1
   * against both the element and the background"). That requirement is *unsatisfiable* for a
   * single-colour ring: in the light theme a ring must be ≥3:1 from a near-white canvas
   * (which forces it dark) and ≥3:1 from a mid-dark violet button (which forces it light),
   * and no colour is both. The offset is what resolves it — and it is why the offset is a
   * contract rather than a style choice. Remove the offset and this contract is a lie.
   */
  for (const surface of READABLE_SURFACES) {
    reqs.push({
      id: `focus.ring on bg.${surface}`,
      foreground: c.focus.ring,
      background: c.bg[surface],
      minRatio: AA_NON_TEXT,
      why: 'Keyboard users navigate by this ring. It is not decoration (Standards §3).',
    });
  }

  return reqs;
}

export function auditTheme(theme: ThemeName): ContrastResult[] {
  const colors = themes[theme];
  return requirementsFor(colors).map((req) => {
    const ratio = contrastRatioFloor(req.foreground, req.background);
    return {
      ...req,
      theme,
      fgHex: req.foreground,
      bgHex: req.background,
      ratio,
      passed: ratio >= req.minRatio,
    };
  });
}

export function auditAllThemes(): ContrastResult[] {
  return [...auditTheme('light'), ...auditTheme('dark')];
}
