import type { EditIntent, Language } from '@fixora/shared-types';

/**
 * Intent detection for Proceed Mode (P2.1).
 *
 * A deliberately DETERMINISTIC classifier: a natural-language editing instruction is scored against a
 * curated keyword lexicon per category, and the best-scoring category wins. No model call — intent is
 * cheap, must be reproducible, and must never itself be a source of non-determinism or cost. An
 * instruction that matches nothing is `unknown`, which the pipeline refuses gracefully rather than
 * guessing. This is the FOUNDATION classifier (objective 2); richer intent is a later milestone.
 */

export interface IntentResult {
  readonly intent: EditIntent;
  /** 0–1, derived from how strongly the instruction matched the winning category vs the field. */
  readonly confidence: number;
  /** The concrete tokens that fired, so a decision is explainable and testable — never a black box. */
  readonly matched: readonly string[];
}

/**
 * Category lexicons. Order matters only for stable tie-breaking (earlier wins an exact tie). Each entry
 * is a lowercase phrase matched on word boundaries, so "type" does not fire inside "typewriter".
 */
const LEXICON: readonly (readonly [EditIntent, readonly string[]])[] = [
  [
    'styling',
    [
      'color',
      'colour',
      'green',
      'red',
      'blue',
      'yellow',
      'purple',
      'orange',
      'pink',
      'black',
      'white',
      'gray',
      'grey',
      'background',
      'css',
      'style',
      'styles',
      'styling',
      'margin',
      'padding',
      'font',
      'font-size',
      'responsive',
      'layout',
      'flex',
      'grid',
      'align',
      'center',
      'centre',
      'centered',
      'centred',
      'spacing',
      'theme',
      'dark mode',
      'light mode',
      'rounded',
      'border',
      'shadow',
      'width',
      'height',
      'hover',
    ],
  ],
  [
    'react',
    [
      'component',
      'hook',
      'usestate',
      'useeffect',
      'usememo',
      'usecallback',
      'useref',
      'prop',
      'props',
      'jsx',
      'render',
      'loading state',
      'loading spinner',
      'state',
      'context provider',
      'memoize',
      'controlled input',
    ],
  ],
  [
    'typescript',
    [
      'typescript',
      'convert to typescript',
      'type',
      'types',
      'interface',
      'generic',
      'generics',
      'type annotation',
      'annotate',
      'strict types',
      'enum',
      'union type',
    ],
  ],
  [
    'python',
    ['python', 'pytest', 'def ', 'dataclass', 'type hint', 'type hints', 'mypy', 'f-string'],
  ],
  [
    'documentation',
    [
      'document',
      'documentation',
      'docstring',
      'comment',
      'comments',
      'jsdoc',
      'tsdoc',
      'readme',
      'annotate with comments',
      'explain in comments',
    ],
  ],
  [
    'refactoring',
    [
      'rename',
      'refactor',
      'extract',
      'inline',
      'simplify',
      'deduplicate',
      'clean up',
      'cleanup',
      'reorganize',
      'reorganise',
      'move',
      'split',
      'variable',
      'function name',
      'method',
      'rename this',
      // Structural edits (add/insert/set a field/property/key) — a real, common request that otherwise
      // fell through to `unknown`. Kept specific so "add loading state" still reads as React.
      'add a field',
      'add a property',
      'add a key',
      'add a top-level field',
      'add an entry',
      'insert',
      'set to',
    ],
  ],
  [
    'explanation',
    ['explain', 'why is', 'why does', 'what does', 'what is', 'how does', 'how do', 'describe'],
  ],
];

/**
 * Action verbs that make a sentence an *instruction*. This is the safety net behind the lexicon: an
 * instruction with a real action ("add error handling", "wrap this in try/catch") is a valid edit
 * request even when it matches no specific category, and must never be refused. Only input with no
 * recognisable action at all — empty, or "asdf qwerty" — is `unknown`.
 */
const ACTION_VERBS: readonly string[] = [
  'add',
  'remove',
  'delete',
  'rename',
  'replace',
  'change',
  'update',
  'make',
  'convert',
  'wrap',
  'extract',
  'inline',
  'move',
  'split',
  'merge',
  'sort',
  'fix',
  'handle',
  'simplify',
  'refactor',
  'set',
  'insert',
  'use',
  'turn',
  'apply',
  'guard',
  'validate',
  'rewrite',
  'annotate',
  'document',
  'center',
  'centre',
  'align',
  'increase',
  'decrease',
  'disable',
  'enable',
  'support',
];

/** Match a phrase on word boundaries in a normalized (lowercased) instruction. */
function fires(haystack: string, phrase: string): boolean {
  if (phrase.endsWith(' ')) return haystack.includes(phrase); // e.g. "def " — keep the trailing space
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Boundaries that also treat hyphen/space-delimited phrases correctly.
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

/**
 * Language-specific categories that CONTRADICT the file being edited are impossible, so they are
 * removed from contention. This fixes a real misclassification: a `.py` file's "add a type hint"
 * matched both `python` ("type hint") and `typescript` ("type", "type annotation"), and TypeScript
 * won on count — for a Python file. A `.ts` file is never a Python edit, and vice versa.
 */
function contradicts(intent: EditIntent, language: Language | undefined): boolean {
  if (language === undefined) return false;
  if (language === 'python') return intent === 'typescript' || intent === 'react';
  if (language === 'typescript' || language === 'javascript') return intent === 'python';
  return false;
}

export interface ClassifyOptions {
  /** The language of the file being edited — used to drop contradictory language categories. */
  readonly language?: Language;
}

export function classifyIntent(instruction: string, options: ClassifyOptions = {}): IntentResult {
  const text = instruction.toLowerCase().trim();
  if (text === '') return { intent: 'unknown', confidence: 0, matched: [] };

  let best: { intent: EditIntent; matched: string[] } | null = null;
  for (const [intent, phrases] of LEXICON) {
    if (contradicts(intent, options.language)) continue;
    const matched = phrases.filter((p) => fires(text, p));
    if (matched.length === 0) continue;
    if (best === null || matched.length > best.matched.length) best = { intent, matched };
  }

  if (best === null) {
    // No specific category matched. If the instruction still contains a real action, it IS a valid
    // edit request — classify it `general` rather than refusing it. Refusing valid English because a
    // keyword list is finite was the single biggest usability defect in Proceed.
    const verb = ACTION_VERBS.find((v) => fires(text, v));
    if (verb !== undefined) return { intent: 'general', confidence: 0.4, matched: [verb] };
    return { intent: 'unknown', confidence: 0, matched: [] };
  }

  // Confidence: saturating in the number of distinct signals, capped below 1 (a keyword classifier is
  // never certain). One hit ≈ 0.6, two ≈ 0.8, three+ ≈ 0.9.
  const confidence = Math.min(0.9, 0.4 + 0.2 * best.matched.length);
  return { intent: best.intent, confidence, matched: best.matched };
}
