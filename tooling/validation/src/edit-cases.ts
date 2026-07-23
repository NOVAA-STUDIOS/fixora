/**
 * The Proceed-Mode editing acceptance cases (P2.2, objective 7). Each is a real file in the validation
 * corpus, a natural-language instruction, and the user's selection — the exact shape the running app
 * sends. Chosen to exercise each supported language and a spread of intents. CSS/HTML are listed so the
 * harness reports them honestly as unsupported (no analyzer/grammar), never silently skipped.
 */
export interface EditCase {
  /** Corpus project name (validation.json `name`). */
  project: string;
  file: string;
  instruction: string;
  selectionStartLine: number;
  selectionEndLine?: number;
}

export const EDIT_CASES: readonly EditCase[] = [
  {
    project: 'javascript-http-cache',
    file: 'cache.js',
    instruction: 'add a short JSDoc comment describing the get method',
    selectionStartLine: 17,
  },
  {
    project: 'typescript-pricing',
    file: 'src/pricing.ts',
    instruction: 'add a JSDoc comment to the subtotal function',
    selectionStartLine: 11,
  },
  {
    project: 'react-counter',
    file: 'src/Counter.tsx',
    instruction: 'make the button green by adding a style with a green background',
    selectionStartLine: 9,
  },
  {
    project: 'python-text-metrics',
    file: 'metrics.py',
    instruction: 'add a type hint annotation for the text parameter of word_count (it is a str)',
    selectionStartLine: 10, // the `def word_count(...)` line
  },
  {
    project: 'json-app-config',
    file: 'config.json',
    instruction: 'add a top-level field "maxConnections" set to the number 10',
    selectionStartLine: 2,
  },
  // CSS / HTML — no grammar or analyzer in the engine, so the harness reports these unsupported.
  {
    project: 'css-theme',
    file: 'theme.css',
    instruction: 'add 24px of padding to the .card rule',
    selectionStartLine: 10,
  },
  {
    project: 'html-landing',
    file: 'index.html',
    instruction: 'add a class "hero" to the main element',
    selectionStartLine: 8,
  },
];
