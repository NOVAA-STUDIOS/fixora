import { buildTestGenerationRequest, describeProviderFailure, parseGeneratedTests } from '@fixora/core-ai';
import { UserFacingError } from '@fixora/shared-types';

import type { Orchestrator, ResolvedCandidate } from '../../ai/providers/orchestrator.js';
import { readTextFile, writeTextFile } from '../../services/fs/fs-service.js';
import type { WorkspaceService } from '../../services/workspace-service.js';
import { registerHandler } from '../router.js';

/**
 * Test generation (feature #7). A separate, additive path — it reuses the same BYOK provider
 * chain repair uses (`orchestrator`), but grounds on a file's own content rather than a stored
 * finding, and never touches the repair/verification pipeline.
 */

const EXT_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
};

function extOf(relPath: string): string {
  const dot = relPath.lastIndexOf('.');
  return dot === -1 ? '' : relPath.slice(dot + 1);
}

/** `foo.ts` → `foo.test.ts`; `foo.py` → `test_foo.py` — the convention each ecosystem expects. */
function testPathFor(relPath: string, ext: string): string {
  const dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/') + 1) : '';
  const base = relPath.slice(dir.length, relPath.length - ext.length - 1);
  return ext === 'py' ? `${dir}test_${base}.py` : `${dir}${base}.test.${ext}`;
}

/** Where an existing test file for this source would live, if one already exists — checked so the
 *  prompt can match the project's own framework/import/assertion style instead of guessing. */
function existingTestCandidates(relPath: string, ext: string): string[] {
  const dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/') + 1) : '';
  const base = relPath.slice(dir.length, relPath.length - ext.length - 1);
  return ext === 'py'
    ? [`${dir}test_${base}.py`, `${dir}${base}_test.py`]
    : [`${dir}${base}.test.${ext}`, `${dir}${base}.spec.${ext}`];
}

export function registerTestGenerationHandlers(deps: {
  workspace: WorkspaceService;
  orchestrator: Orchestrator;
}): void {
  registerHandler('ai:generateTests', async ({ file }) => {
    const workspace = deps.workspace.getCurrent();
    if (workspace === null) {
      throw new UserFacingError('No project is open, so there is no file to generate tests for.', {
        code: 'no_workspace',
        action: { type: 'open_settings', label: 'Open a project' },
        stage: 'validation',
      });
    }

    const ext = extOf(file);
    const language = EXT_LANGUAGE[ext];
    if (language === undefined) {
      throw new UserFacingError(
        `Fixora can generate tests for TypeScript, JavaScript, and Python files. "${file}" isn't one of those.`,
        { code: 'unsupported_language', action: { type: 'none', label: 'Dismiss' }, stage: 'validation' },
      );
    }

    const fileContent = readTextFile(workspace.rootPath, file).content;

    let existingTestStyle: string | null = null;
    for (const candidate of existingTestCandidates(file, ext)) {
      try {
        existingTestStyle = readTextFile(workspace.rootPath, candidate).content;
        break;
      } catch {
        // No test file at this candidate path — try the next, or fall back to no style hint.
      }
    }

    const chain = await deps.orchestrator.resolveChain('test');
    if (!chain.ok) {
      const message =
        chain.reason === 'no-credentials'
          ? 'Set up an AI provider in Settings → AI to generate tests.'
          : chain.reason === 'no-capable-provider'
            ? 'None of your configured providers support test generation.'
            : 'No AI provider is enabled. Set one up in Settings → AI.';
      throw new UserFacingError(message, {
        code: 'no_provider',
        action: { type: 'open_settings', label: 'Open Settings' },
        stage: 'provider',
      });
    }

    const controller = new AbortController();
    const walk = await deps.orchestrator.run(
      'test',
      async (candidate: ResolvedCandidate) => {
        const request = buildTestGenerationRequest({
          model: candidate.model,
          language,
          fileRelPath: file,
          fileContent,
          existingTestStyle,
        });
        let buffer = '';
        for await (const event of candidate.adapter.stream(request, controller.signal)) {
          if (event.type === 'text_delta') buffer += event.text;
          else if (event.type === 'error') {
            return {
              ok: false as const,
              failure: describeProviderFailure({
                providerCode: event.providerCode,
                detail: event.message,
                retryable: event.retryable,
                ...(event.rateLimit === undefined ? {} : { rateLimit: event.rateLimit }),
              }),
            };
          }
        }
        return { ok: true as const, value: buffer };
      },
      { signal: controller.signal },
    );

    if (!walk.ok) {
      throw new UserFacingError(
        'Fixora could not generate tests — every configured provider failed. Try again, or check Settings → AI.',
        { code: 'generation_failed', action: { type: 'retry', label: 'Try again' }, stage: 'provider' },
      );
    }

    const parsed = parseGeneratedTests(walk.value);
    if (!parsed.ok) {
      throw new UserFacingError(
        `Fixora generated a response that wasn't usable as a test file (${parsed.reason}). Try again.`,
        { code: 'unparseable_response', action: { type: 'retry', label: 'Try again' }, stage: 'parse' },
      );
    }

    const testRelPath = testPathFor(file, ext);
    writeTextFile(workspace.rootPath, testRelPath, parsed.value.testCode);

    return {
      relPath: testRelPath,
      framework: parsed.value.framework,
      rationale: parsed.value.rationale,
    };
  });
}
