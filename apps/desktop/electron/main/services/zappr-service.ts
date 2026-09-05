import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describeProviderFailure, type ProviderRequest } from '@fixora/core-ai';
import type { EventChannel, EventPayloadOf, ZapprStep } from '@fixora/shared-types';
import type { BrowserWindow } from 'electron';

import type { Orchestrator } from '../ai/providers/orchestrator.js';
import { emitToWindow } from '../ipc/emit.js';

import { deletePath, listDirectory, writeTextFile } from './fs/fs-service.js';
import type { WorkspaceService } from './workspace-service.js';

const MAX_CONTEXT_FILES = 20;
const ZAPPR_MODEL_MAX_TOKENS = 4000;

export interface ZapprService {
  run(prompt: string): Promise<{ ok: boolean; error?: string }>;
  cancel(): void;
  getContext(): Promise<{ files: string[]; hasPackageJson: boolean }>;
}

/** Top-level (non-recursive) file listing, capped — the model needs a rough sense of the
 *  project, not an exhaustive tree. */
async function listContextFiles(rootPath: string, workspace: WorkspaceService): Promise<string[]> {
  const open = workspace.getCurrent();
  if (open === null) return [];
  const entries = await listDirectory(rootPath, '', open.ignore);
  return entries.filter((e) => e.kind === 'file').slice(0, MAX_CONTEXT_FILES).map((e) => e.relPath);
}

function buildSystemPrompt(workspaceName: string, files: string[], prompt: string): string {
  return `You are Zappr, an AI coding agent inside Fixora.
You help developers create and edit code files.

Current project: ${workspaceName}
Files: ${files.join(', ')}

User request: ${prompt}

Respond with a JSON plan:
{
"steps": [
{ "type": "create|edit|delete", "filePath": "relative/path", "description": "what you'll do", "content": "full file content" }
],
"summary": "What I'll do in one sentence"
}

Rules:
- Always use relative paths
- Full file content for create/edit
- Be concise and practical
- Respond with ONLY the JSON object, no markdown fences, no prose`;
}

/** Best-effort JSON extraction — the model may wrap the object in prose or markdown fences
 *  despite being asked not to. */
function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON object found in response');
  return JSON.parse(candidate.slice(start, end + 1));
}

function isValidStep(value: unknown): value is ZapprStep {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v['type'] === 'create' || v['type'] === 'edit' || v['type'] === 'delete') &&
    typeof v['filePath'] === 'string' &&
    typeof v['description'] === 'string' &&
    (v['content'] === undefined || typeof v['content'] === 'string')
  );
}

export function createZapprService(
  orchestrator: Orchestrator,
  workspace: WorkspaceService,
  window: BrowserWindow | null,
): ZapprService {
  let cancelled = false;

  function emit<E extends EventChannel>(channel: E, payload: EventPayloadOf<E>): void {
    if (window !== null && !window.isDestroyed()) emitToWindow(window, channel, payload);
  }

  async function getContext(): Promise<{ files: string[]; hasPackageJson: boolean }> {
    const open = workspace.getCurrent();
    if (open === null) return { files: [], hasPackageJson: false };
    const files = await listContextFiles(open.rootPath, workspace);
    return { files, hasPackageJson: existsSync(join(open.rootPath, 'package.json')) };
  }

  function cancel(): void {
    cancelled = true;
  }

  async function run(prompt: string): Promise<{ ok: boolean; error?: string }> {
    cancelled = false;
    const open = workspace.getCurrent();
    if (open === null) return { ok: false, error: 'No project is open.' };

    const files = await listContextFiles(open.rootPath, workspace);
    const systemPrompt = buildSystemPrompt(open.name, files, prompt);

    const request: ProviderRequest = {
      model: '',
      messages: [{ role: 'user', content: systemPrompt }],
      maxOutputTokens: ZAPPR_MODEL_MAX_TOKENS,
    };

    let fullText = '';
    // Reuses the same orchestrator (provider resolution + failover) every other AI feature routes
    // through — 'explain' is the closest existing routing profile for a freeform-text task; Zappr
    // has no verification/repair contract, so it does not go through ai-service.ts's AiService.run().
    const outcome = await orchestrator.run('explain', async (candidate) => {
      try {
        const req = { ...request, model: candidate.model };
        for await (const event of candidate.adapter.stream(req, new AbortController().signal)) {
          if (cancelled) return { ok: false, failure: describeProviderFailure({ providerCode: 'cancelled', detail: 'Cancelled', retryable: false }) };
          if (event.type === 'text_delta') {
            fullText += event.text;
            emit('zappr:delta', { text: event.text });
          } else if (event.type === 'error') {
            return {
              ok: false,
              failure: describeProviderFailure({
                providerCode: event.providerCode,
                detail: event.message,
                retryable: event.retryable,
              }),
            };
          }
        }
        return { ok: true, value: fullText };
      } catch (error) {
        return {
          ok: false,
          failure: describeProviderFailure({
            providerCode: 'unknown',
            detail: error instanceof Error ? error.message : String(error),
            retryable: false,
          }),
        };
      }
    });

    if (!outcome.ok) {
      const message = 'refused' in outcome ? 'No AI provider is configured.' : outcome.failure.message;
      return { ok: false, error: message };
    }
    // `cancelled` can flip true concurrently, from `cancel()`, while the await above was pending —
    // a real runtime possibility the linter's static narrowing cannot see.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (cancelled) return { ok: false, error: 'Cancelled.' };

    let plan: { steps: ZapprStep[]; summary: string };
    try {
      const parsed = extractJson(outcome.value);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !Array.isArray((parsed as Record<string, unknown>)['steps'])
      ) {
        throw new Error('Malformed plan shape');
      }
      const rawSteps = (parsed as { steps: unknown[] }).steps;
      if (!rawSteps.every(isValidStep)) throw new Error('Malformed step in plan');
      plan = {
        steps: rawSteps,
        summary: typeof (parsed as Record<string, unknown>)['summary'] === 'string'
          ? (parsed as { summary: string }).summary
          : '',
      };
    } catch (error) {
      return {
        ok: false,
        error: `Zappr's response wasn't valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    emit('zappr:plan', { steps: plan.steps, summary: plan.summary });

    const filesChanged: string[] = [];
    for (let i = 0; i < plan.steps.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- can flip mid-loop via cancel()
      if (cancelled) break;
      const step = plan.steps[i];
      if (step === undefined) continue;
      emit('zappr:stepStart', { index: i, step });
      try {
        if (step.type === 'delete') {
          deletePath(open.rootPath, step.filePath);
        } else {
          writeTextFile(open.rootPath, step.filePath, step.content ?? '');
        }
        filesChanged.push(step.filePath);
        emit('zappr:stepDone', { index: i, success: true });
      } catch (error) {
        emit('zappr:stepDone', {
          index: i,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    emit('zappr:done', { success: !cancelled, filesChanged });
    return { ok: true };
  }

  return { run, cancel, getContext };
}
