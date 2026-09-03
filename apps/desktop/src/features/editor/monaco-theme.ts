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
      // `renderLineHighlight: 'none'` (code-editor.tsx) means Monaco no longer paints this at
      // all — transparent regardless, kept explicit so a future flip back to 'all'/'line' doesn't
      // silently resurrect the red-looking highlight this pair was set to fix.
      'editor.lineHighlightBackground': 'transparent',
      'editor.lineHighlightBorder': 'transparent',
      'editorIndentGuide.background1': c.border.subtle,
      'editorGutter.background': c.bg.canvas,
      'editorWidget.background': c.bg.overlay,
      'editorWidget.border': c.border.subtle,
      focusBorder: c.accent.solid,
    },
  };
}

/**
 * Two more editor colour themes (Settings > Editor theme), independent of the app's own light/dark
 * toggle the same way VS Code's colour-theme picker is independent of its OS-appearance-follow
 * setting — these are fixed regardless of `theme`. Unlike the Fixora themes above (chrome colours
 * only, `rules: []`, syntax highlighting falls back to Monaco's `vs-dark` default), these carry
 * real token colour `rules`: a genuinely different theme has to recolour keywords/strings/comments,
 * not just the background.
 */
export const MONOKAI = 'fixora-monokai';
export const SOLARIZED_DARK = 'fixora-solarized-dark';

const MONOKAI_THEME: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '75715e' },
    { token: 'keyword', foreground: 'f92672' },
    { token: 'string', foreground: 'e6db74' },
    { token: 'number', foreground: 'ae81ff' },
    { token: 'type', foreground: '66d9ef', fontStyle: 'italic' },
    { token: 'function', foreground: 'a6e22e' },
    { token: 'variable', foreground: 'f8f8f2' },
    { token: 'delimiter', foreground: 'f8f8f2' },
  ],
  colors: {
    'editor.background': '#272822',
    'editor.foreground': '#f8f8f2',
    'editorLineNumber.foreground': '#75715e',
    'editorLineNumber.activeForeground': '#f8f8f2',
    'editorCursor.foreground': '#f8f8f0',
    'editor.lineHighlightBackground': '#3e3d32',
  },
};

const SOLARIZED_DARK_THEME: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '586e75' },
    { token: 'keyword', foreground: '859900' },
    { token: 'string', foreground: '2aa198' },
    { token: 'number', foreground: 'd33682' },
    { token: 'type', foreground: 'b58900' },
    { token: 'function', foreground: '268bd2' },
    { token: 'variable', foreground: '839496' },
    { token: 'delimiter', foreground: '839496' },
  ],
  colors: {
    'editor.background': '#002b36',
    'editor.foreground': '#839496',
    'editorLineNumber.foreground': '#586e75',
    'editorLineNumber.activeForeground': '#93a1a1',
    'editorCursor.foreground': '#839496',
    'editor.lineHighlightBackground': '#073642',
  },
};

export const DRACULA = 'fixora-dracula';
export const GITHUB_DARK = 'fixora-github-dark';
export const ONE_DARK = 'fixora-one-dark';

const DRACULA_THEME: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6272a4' },
    { token: 'keyword', foreground: 'ff79c6' },
    { token: 'string', foreground: 'f1fa8c' },
    { token: 'number', foreground: 'bd93f9' },
    { token: 'type', foreground: '8be9fd' },
    { token: 'function', foreground: '50fa7b' },
    { token: 'variable', foreground: 'f8f8f2' },
    { token: 'delimiter', foreground: 'ff79c6' },
  ],
  colors: {
    'editor.background': '#282a36',
    'editor.foreground': '#f8f8f2',
    'editorLineNumber.foreground': '#6272a4',
    'editorLineNumber.activeForeground': '#f8f8f2',
    'editorCursor.foreground': '#f8f8f0',
    'editor.lineHighlightBackground': '#44475a',
  },
};

const GITHUB_DARK_THEME: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '8b949e' },
    { token: 'keyword', foreground: 'ff7b72' },
    { token: 'string', foreground: 'a5d6ff' },
    { token: 'number', foreground: '79c0ff' },
    { token: 'type', foreground: 'ffa657' },
    { token: 'function', foreground: 'd2a8ff' },
    { token: 'variable', foreground: 'c9d1d9' },
    { token: 'delimiter', foreground: 'ff7b72' },
  ],
  colors: {
    'editor.background': '#0d1117',
    'editor.foreground': '#c9d1d9',
    'editorLineNumber.foreground': '#8b949e',
    'editorLineNumber.activeForeground': '#c9d1d9',
    'editorCursor.foreground': '#c9d1d9',
    'editor.lineHighlightBackground': '#388bfd26',
  },
};

const ONE_DARK_THEME: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '5c6370' },
    { token: 'keyword', foreground: 'c678dd' },
    { token: 'string', foreground: '98c379' },
    { token: 'number', foreground: 'd19a66' },
    { token: 'type', foreground: 'e5c07b' },
    { token: 'function', foreground: '61afef' },
    { token: 'variable', foreground: 'e06c75' },
    { token: 'delimiter', foreground: '56b6c2' },
  ],
  colors: {
    'editor.background': '#282c34',
    'editor.foreground': '#abb2bf',
    'editorLineNumber.foreground': '#4b5263',
    'editorLineNumber.activeForeground': '#abb2bf',
    'editorCursor.foreground': '#528bff',
    'editor.lineHighlightBackground': '#3e4451',
  },
};

let registered = false;

/** Register every editor theme once. Idempotent — safe to call on every editor mount. */
export function ensureThemes(m: typeof monaco): void {
  if (registered) return;
  m.editor.defineTheme(FIXORA_DARK, themeFrom('vs-dark', dark));
  m.editor.defineTheme(FIXORA_LIGHT, themeFrom('vs', light));
  m.editor.defineTheme(MONOKAI, MONOKAI_THEME);
  m.editor.defineTheme(SOLARIZED_DARK, SOLARIZED_DARK_THEME);
  m.editor.defineTheme(DRACULA, DRACULA_THEME);
  m.editor.defineTheme(GITHUB_DARK, GITHUB_DARK_THEME);
  m.editor.defineTheme(ONE_DARK, ONE_DARK_THEME);
  registered = true;
}

export function themeForAppearance(theme: 'dark' | 'light'): string {
  return theme === 'dark' ? FIXORA_DARK : FIXORA_LIGHT;
}

/** Resolves the Settings > Editor theme choice to the Monaco theme name to apply — 'fixora' still
 * follows the app's light/dark toggle; the named themes are fixed regardless of it. */
export function resolveEditorTheme(
  editorTheme: 'fixora' | 'monokai' | 'solarized-dark' | 'dracula' | 'github-dark' | 'one-dark',
  appearance: 'dark' | 'light',
): string {
  if (editorTheme === 'monokai') return MONOKAI;
  if (editorTheme === 'solarized-dark') return SOLARIZED_DARK;
  if (editorTheme === 'dracula') return DRACULA;
  if (editorTheme === 'github-dark') return GITHUB_DARK;
  if (editorTheme === 'one-dark') return ONE_DARK;
  return themeForAppearance(appearance);
}
