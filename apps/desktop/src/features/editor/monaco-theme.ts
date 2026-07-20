import { dark, light, type SemanticColors } from '@fixora/tokens';
import type * as monaco from 'monaco-editor';

/**
 * Monaco themes built from the design tokens (ADR-019), so the editor is the same near-black canvas
 * and violet accent as the rest of the app rather than VS Code's defaults. Monaco needs concrete
 * hex (it cannot read CSS variables), so we feed it the token values directly — the one place a
 * component legitimately reads token hex, because Monaco is not a Tailwind consumer.
 */
export const FIXORA_DARK = 'fixora-dark';
export const FIXORA_LIGHT = 'fixora-light';

function themeFrom(base: 'vs' | 'vs-dark', c: SemanticColors): monaco.editor.IStandaloneThemeData {
  return {
    base,
    inherit: true,
    rules: [],
    colors: {
      // Matches the editor card's surface (`bg-canvas`), not the shell base. Monaco painting a
      // different near-black than its own container is the kind of 2px mismatch that reads as
      // cheap without anyone being able to say why.
      'editor.background': c.bg.canvas,
      'editor.foreground': c.text.primary,
      'editorLineNumber.foreground': c.text.muted,
      'editorLineNumber.activeForeground': c.text.secondary,
      'editorCursor.foreground': c.accent.solid,
      'editor.selectionBackground': c.accent.subtle,
      'editor.lineHighlightBackground': c.bg.hover,
      'editorIndentGuide.background1': c.border.subtle,
      'editorGutter.background': c.bg.canvas,
      'editorWidget.background': c.bg.overlay,
      'editorWidget.border': c.border.subtle,
      focusBorder: c.accent.solid,
    },
  };
}

let registered = false;

/** Register the Fixora themes once. Idempotent — safe to call on every editor mount. */
export function ensureThemes(m: typeof monaco): void {
  if (registered) return;
  m.editor.defineTheme(FIXORA_DARK, themeFrom('vs-dark', dark));
  m.editor.defineTheme(FIXORA_LIGHT, themeFrom('vs', light));
  registered = true;
}

export function themeForAppearance(theme: 'dark' | 'light'): string {
  return theme === 'dark' ? FIXORA_DARK : FIXORA_LIGHT;
}
