import { TEST_JSON_SCHEMA, parseTestOutput, type ParseResult } from '../profiles/schemas.js';
import type { ProviderMessage, ProviderRequest } from '../provider/types.js';

/**
 * Test generation (Repair feature #7). A separate, additive pipeline — it reuses the repair
 * engine's schema-constrained-output discipline (TEST_JSON_SCHEMA, no fence-scraping) but never
 * touches the repair/verification path itself.
 */
export interface TestGenerationInput {
  readonly model: string;
  readonly language: string;
  readonly fileRelPath: string;
  readonly fileContent: string;
  /**
   * An existing test file's content, when one was found alongside the target — its imports and
   * assertion style are shown to the model so generated tests match the project's own conventions
   * rather than a generic default. Null when no test file was found.
   */
  readonly existingTestStyle: string | null;
}

const SYSTEM_PROMPT =
  'You write focused, correct unit tests for the given source file. Cover the file\'s exported ' +
  'behavior, including realistic edge cases. Never invent APIs the file does not export. Respond ' +
  'only with the required JSON object — no prose, no markdown fences.';

export function buildTestGenerationRequest(input: TestGenerationInput): ProviderRequest {
  const styleNote =
    input.existingTestStyle !== null
      ? `An existing test file in this project looks like this — match its framework, import style, ` +
        `and assertion style:\n\n${input.existingTestStyle}\n\n`
      : '';

  const userContent =
    `Language: ${input.language}\nFile: ${input.fileRelPath}\n\n${styleNote}` +
    `Source file to test:\n\n${input.fileContent}`;

  const messages: ProviderMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  return {
    model: input.model,
    messages,
    responseSchema: TEST_JSON_SCHEMA,
    temperature: 0.2,
  };
}

export function parseGeneratedTests(
  raw: string,
): ParseResult<{ framework: string; testCode: string; rationale: string }> {
  return parseTestOutput(raw);
}
