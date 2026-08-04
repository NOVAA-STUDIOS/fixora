import type { TaskProfile } from '@fixora/shared-types';

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

const EXPLAIN_SYSTEM = [
  'You are Fixora. Explain the given finding to a working developer. Answer three questions, in this',
  'order and always all three: (1) WHY THIS HAPPENED — what in the code shown caused the tool to',
  'report it, specific to this code and not a description of the rule in general; (2) WHY IT CANNOT',
  'BE REPAIRED AUTOMATICALLY — include this section only when the message names a classification',
  '(Configuration Issue, Manual Review, Unsupported), and explain it in terms of this finding rather',
  'than restating the label; (3) WHAT TO DO — numbered, concrete steps the developer can follow,',
  'naming the exact command, file or edit where one is knowable. Never answer vaguely: "review the',
  'code" or "consider refactoring" are not steps. Concise markdown. Do not propose a full rewrite —',
  'this is an explanation, not a patch.',
].join(' ');

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
  const messages: ProviderMessage[] = [
    { role: 'system', content: def.system },
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
