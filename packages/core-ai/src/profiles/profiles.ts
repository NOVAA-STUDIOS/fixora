import type { Category, TaskProfile } from '@fixora/shared-types';

import type { BuiltContext } from '../context/context-builder.js';
import type { ProviderMessage, ProviderRequest, ResponseSchema } from '../provider/types.js';

import { languageRuleBlock } from './language-rules.js';
import { REPAIR_JSON_SCHEMA, TEST_JSON_SCHEMA } from './schemas.js';

/**
 * Task profiles (AI-Pipeline §5). Each profile is the *policy* for one kind of request: its system
 * prompt, whether it wants schema-constrained structured output, and its sampling temperature. The
 * user message is built the same way for all three — from the grounded context — so the model always
 * reasons over the same evidence and only the instruction differs.
 *
 * `repair` and `test` are low-temperature and schema-constrained (they write code). `explain` is prose.
 */

interface ProfileDef {
  readonly system: string;
  readonly responseSchema?: ResponseSchema;
  readonly temperature: number;
}

const REPAIR_SYSTEM = [
  'You are Fixora, a verified code-repair engine. You fix exactly one grounded finding by rewriting',
  'ONLY the target symbol you are given. You never touch code outside it and never rewrite the whole',
  'file. Preserve the surrounding style, indentation, and the public signature unless the fix requires',
  'changing it. Your replacement must be valid, runnable code in the stated Language, and in that',
  'language only. A diagnostic may be reported by a tool whose syntax is broader than the file’s —',
  'a TypeScript type-checker inspecting a JavaScript file, for example. When that happens, the',
  'language of the FILE wins: never introduce syntax the file’s own language cannot parse, and',
  'resolve the underlying problem with a construct that language actually has.',
  'Return JSON matching the schema: `repairedCode` is the complete replacement for the',
  'target symbol (not a diff, not the whole file); `rationale` explains why the original was wrong and',
  'how the fix resolves the finding; `confidence` is your honest 0–1 estimate. No prose outside the JSON.',
].join(' ');

/**
 * Category-specific guidance, appended to REPAIR_SYSTEM.
 *
 * `Finding.category` is set by every analyzer adapter and already drives dedup and panel grouping,
 * but the repair prompt ignored it entirely — a security fix and a style nit got byte-identical
 * instructions. These say what "a good fix" means for each kind, and nothing else: they never
 * relax the schema, the scope rule, or any gate.
 *
 * Deliberately NOT merged with the rule-specific complexity block in `context-builder.ts`.
 * `maintainability` is also produced by ruff (PLR and C prefixes) and semgrep, so folding complexity
 * text in here would tell a rule with no metric to "reduce the metric below its threshold". The
 * two compose instead: a complexity finding gets this block AND that one.
 */
const CATEGORY_GUIDANCE: Record<Category, string> = {
  security:
    'This is a SECURITY finding. Prioritise safety over brevity: never weaken or remove an existing ' +
    'check, and prefer the change that closes the hole outright over one that narrows it.',
  correctness:
    'This is a CORRECTNESS finding. Fix the root cause the diagnostic points at, not the symptom — ' +
    'a change that only silences the tool while leaving the underlying defect is wrong.',
  performance:
    'This is a PERFORMANCE finding. Do not introduce new allocations, copies, or loops to fix it, ' +
    'and keep the asymptotic behaviour no worse than it already is.',
  maintainability:
    'This is a MAINTAINABILITY finding. Prefer the smallest, most readable change that resolves it; ' +
    'do not restructure code the finding does not name.',
  style:
    "This is a STYLE finding. Match the surrounding file's existing conventions exactly — its " +
    'quoting, spacing, naming and formatting — rather than applying a different house style.',
};

const EXPLAIN_SYSTEM = [
  'You are a friendly coding teacher explaining to a complete beginner. Use simple words,',
  'real-world analogies, and short sentences. Never use jargon without explaining it first.',
  'Structure your response exactly as:',
  '',
  "🔴 **What's wrong**: [1-2 simple sentences]",
  '',
  '🤔 **Why it matters**: [real world analogy + 1-2 sentences]',
  '',
  '✅ **How to fix it**: [numbered steps, simple language]',
  '',
  '💡 **Example**: [before/after code snippet if helpful]',
  '',
  // The accuracy floor the friendly tone must not cost us. A beginner cannot tell a confident
  // generic answer from a correct one, so vagueness is MORE harmful here, not less: they have no
  // way to notice it is wrong. Every claim stays tied to the code actually shown.
  'Ground every part in the specific code shown — describe what THIS code does, never the rule in',
  'general. In "How to fix it", name the exact file, line, command or edit wherever it is knowable;',
  '"review the code" and "consider refactoring" are not steps. Omit the Example section entirely if',
  'a snippet would not genuinely help, rather than padding it. If the finding cannot be fixed',
  'automatically (the message names a Configuration Issue, Manual Review, or Unsupported',
  'classification), say so plainly in "What\'s wrong" and explain what it means for this finding.',
  'This is an explanation, not a patch — do not propose a full rewrite.',
].join('\n');

const TEST_SYSTEM = [
  'You are Fixora. Write a single focused test for the target symbol that pins the behaviour implicated',
  'by the finding — one that fails against the buggy code and passes once it is correctly fixed. Use the',
  "project's existing test framework if one is given. Return JSON matching the schema: `framework`,",
  '`testCode` (one self-contained test file), and `rationale`. No prose outside the JSON.',
].join(' ');

const PROFILES: Record<TaskProfile, ProfileDef> = {
  repair: { system: REPAIR_SYSTEM, responseSchema: REPAIR_JSON_SCHEMA, temperature: 0.1 },
  explain: { system: EXPLAIN_SYSTEM, temperature: 0.3 },
  test: { system: TEST_SYSTEM, responseSchema: TEST_JSON_SCHEMA, temperature: 0.1 },
};

function buildUserMessage(context: BuiltContext): string {
  const sections: string[] = [];
  sections.push(`Language: ${context.language}`);
  // The dialect constraint, immediately under the language it constrains and BEFORE the finding
  // block. Position is the point: a `Language:` label three sections above loses to a `[tsc] TS2345
  // … type 'never'` diagnostic sitting right next to the answer, which is how a .js file came back
  // with `as any[]`. Null for dialects that need no exclusions, leaving the prompt untouched.
  const rule = languageRuleBlock(context.grammarId);
  if (rule !== null) sections.push(rule);
  sections.push(`File: ${context.filePath}`);
  if (context.conventions.length > 0) {
    sections.push(`Project conventions:\n${context.conventions.join('\n')}`);
  }
  sections.push(`Finding to address:\n${context.evidenceText}`);

  const symbolLabel = context.target.symbolName ?? '(top-level code)';
  sections.push(
    `Target symbol \`${symbolLabel}\` ` +
      `(lines ${String(context.target.startLine)}–${String(context.target.endLine)}):\n` +
      context.target.text,
  );

  if (context.neighbours.length > 0) {
    const neighbourText = context.neighbours.map((n) => `// ${n.label}\n${n.text}`).join('\n\n');
    sections.push(`Related context:\n${neighbourText}`);
  }

  return sections.join('\n\n');
}

export interface BuildRequestOptions {
  readonly model: string;
  readonly maxOutputTokens?: number;
  /**
   * Why the repair scope was widened after a dependent verification failure.
   *
   * Set only on a re-generation that follows `detectDependentFailure`: the previous, narrower patch
   * was correct in isolation and still did not compile, because the edit it needed sat outside the
   * range. Without this the model is handed a wider range with no explanation and typically returns
   * the same one-line change padded with unchanged context — the widening buys nothing.
   */
  readonly prerequisite?: string;
}

/**
 * The instruction appended when a repair is regenerated at a wider scope.
 *
 * Phrased as *one* replacement containing several edits, never as a list of separate fixes: the
 * protocol returns a single block of code for a single range, so framing it as multiple edits invites
 * a reply the splice cannot express. The worked example is the production case — a missing `await` on
 * the declaration that the reported line depends on.
 */
function prerequisiteBlock(reason: string): string {
  return [
    '',
    'IMPORTANT — this code was already repaired once and the result did not compile.',
    reason,
    '',
    'You are now being shown a WIDER range so you can fix the cause as well as the symptom.',
    'Return ONE corrected version of this whole range that includes every edit needed for it to',
    'compile — the prerequisite change AND the original problem, together. Do not fix only the',
    'reported line. Do not leave a change half-applied.',
    '',
    'For example, if the reported problem is `const data = await response.json();` failing because',
    '`response` is a promise, the correct answer changes BOTH lines:',
    '  const response = await fetch(url);',
    '  const data = await response.json();',
    '',
    'Change nothing else in the range: preserve every unrelated line exactly as given.',
  ].join('\n');
}

/**
 * Turn a profile + grounded context into a provider request. This is pure — no network, no key. The
 * gate runs before this is ever handed to a provider (see pipeline/prepare.ts).
 */
export function buildProviderRequest(
  profile: TaskProfile,
  context: BuiltContext,
  options: BuildRequestOptions,
): ProviderRequest {
  const def = PROFILES[profile];
  // Category guidance applies to REPAIR only. Explain is prose about a finding (it describes the
  // problem rather than changing code) and Test writes a test — neither is "make a good fix of
  // this kind", so appending repair guidance there would be instructions for a job not being done.
  const system =
    profile === 'repair'
      ? `${def.system} ${CATEGORY_GUIDANCE[context.finding.category]}`
      : def.system;
  const messages: ProviderMessage[] = [
    { role: 'system', content: system },
    {
      role: 'user',
      content:
        options.prerequisite === undefined
          ? buildUserMessage(context)
          : `${buildUserMessage(context)}\n${prerequisiteBlock(options.prerequisite)}`,
    },
  ];
  return {
    model: options.model,
    messages,
    temperature: def.temperature,
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(def.responseSchema !== undefined ? { responseSchema: def.responseSchema } : {}),
  };
}

export function profileWantsStructuredOutput(profile: TaskProfile): boolean {
  return PROFILES[profile].responseSchema !== undefined;
}
