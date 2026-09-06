import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describeProviderFailure, type ProviderRequest } from '@fixora/core-ai';
import type { EventChannel, EventPayloadOf, ZapprAction, ZapprStep } from '@fixora/shared-types';
import type { BrowserWindow } from 'electron';

import type { Orchestrator } from '../ai/providers/orchestrator.js';
import { emitToWindow } from '../ipc/emit.js';

import { deletePath, listDirectory, writeTextFile } from './fs/fs-service.js';
import type { WorkspaceService } from './workspace-service.js';

const MAX_CONTEXT_FILES = 20;
const ZAPPR_MODEL_MAX_TOKENS = 8000;

type ZapprMode = 'chat' | 'file' | 'math' | 'repair';

/** Regex-based, no AI call needed — fast enough to run before every request. */
function detectMode(prompt: string): ZapprMode {
  if (/\b(create|make|build|generate|write|add|scaffold|new)\b/i.test(prompt)) {
    return 'file';
  }

  if (
    /\b(solve|calculate|equation|integral|derivative|matrix)\b/i.test(prompt) ||
    /[∫∑∏√±×÷]/.test(prompt) ||
    /\d+x/.test(prompt)
  ) {
    return 'math';
  }

  if (/\b(fix|debug|repair|error|bug|issue|crash)\b/i.test(prompt)) {
    return 'repair';
  }

  return 'chat';
}

/** Regex-based, no AI call needed — a Jarvis-style command Zappr can carry out directly. */
function detectAction(prompt: string): ZapprAction {
  if (/open.*(setting|preference)/i.test(prompt)) return { type: 'open_settings' };

  if (/dark.*(mode|theme)|turn.*dark/i.test(prompt)) return { type: 'set_theme', theme: 'dark' };
  if (/light.*(mode|theme)|turn.*light/i.test(prompt)) return { type: 'set_theme', theme: 'light' };

  const providerMatch = /use\s+(openai|gemini|anthropic|groq|openrouter|ollama|deepseek)/i.exec(prompt);
  if (providerMatch !== null) {
    const apiKeyMatch = /key[:\s]+([A-Za-z0-9\-_]{20,})/i.exec(prompt);
    const modelMatch = /model[:\s]+([A-Za-z0-9\-_.:/]+)/i.exec(prompt);
    return {
      type: 'set_provider',
      providerId: providerMatch[1]?.toLowerCase() ?? '',
      apiKey: apiKeyMatch?.[1],
      model: modelMatch?.[1],
    };
  }

  const fileMatch = /create\s+(?:a\s+)?(?:file\s+)?(?:named?\s+)?([A-Za-z0-9_\-./]+\.[a-z]+)/i.exec(prompt);
  if (fileMatch?.[1] !== undefined) return { type: 'create_file', path: fileMatch[1] };

  if (/run\s+analysis|analyze\s+code|check\s+errors/i.test(prompt)) return { type: 'run_analysis' };

  return { type: 'none' };
}

function buildChatPrompt(userPrompt: string, workspaceName: string): string {
  return `You are Zappr — the Jarvis of coding IDEs. You are brilliant, witty, and incredibly capable. You help with ANYTHING instantly.

PERSONALITY:
- Confident and capable like Jarvis/Friday from Marvel
- Friendly but professional
- Brief acknowledgments before answers: "Right away.", "Of course.", "Consider it done."
- Smart, fast, accurate

You help with ANYTHING:
- Coding questions, debugging, architecture
- Math problems (show step-by-step working)
- Study questions, explanations, concepts
- Writing, planning, brainstorming
- Research, analysis, summaries

Current workspace: ${workspaceName}

RESPONSE STYLE:
- Be concise but complete
- Use markdown formatting (headers, bold, code blocks, lists)
- For math: show step-by-step working clearly
- For code: always include working examples
- Be friendly and enthusiastic ⚡
- Keep responses focused and actionable

User: ${userPrompt}`;
}

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

function buildSystemPrompt(workspaceName: string, files: string[], userPrompt: string): string {
  return `You are Zappr — an elite AI coding agent built into Fixora. You are fast, precise, and produce production-quality code instantly.

WORKSPACE: ${workspaceName}
FILES:
${files.map((f) => `  • ${f}`).join('\n')}

YOUR MISSION: ${userPrompt}

RULES (non-negotiable):
1. Return ONLY a raw JSON object — no markdown, no backticks, no prose
2. Use relative file paths only
3. Every file gets its COMPLETE content — no placeholders, no "// rest of code"
4. Write real, working, production-ready code
5. Be opinionated — make the right choices without asking
6. If editing, include the ENTIRE file with your changes merged in

RESPONSE FORMAT (exact):
{"summary":"One sentence — what you're building","steps":[{"type":"create|edit|delete","filePath":"src/example.tsx","description":"What this file does","content":"full file content here"}]}

Think step by step, then respond with ONLY the JSON.`;
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
  let currentAbortController: AbortController | null = null;

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
    currentAbortController?.abort();
    currentAbortController = null;
  }

  async function run(prompt: string): Promise<{ ok: boolean; error?: string }> {
    cancelled = false;

    const action = detectAction(prompt);
    if (action.type !== 'none') {
      emit('zappr:actionResult', {
        ok: true,
        message: `On it! Executing: ${action.type}`,
        action,
      });
    }

    const mode = detectMode(prompt);
    emit('zappr:mode', { mode });

    if (mode === 'file') return runFileMode(prompt);
    return runChatMode(prompt);
  }

  async function runChatMode(prompt: string): Promise<{ ok: boolean; error?: string }> {
    const open = workspace.getCurrent();
    const workspaceName = open?.name ?? 'No project';

    const request: ProviderRequest = {
      model: '',
      messages: [{ role: 'user', content: buildChatPrompt(prompt, workspaceName) }],
      maxOutputTokens: ZAPPR_MODEL_MAX_TOKENS,
    };

    let fullText = '';
    const abortController = new AbortController();
    currentAbortController = abortController;
    const outcome = await orchestrator.run('explain', async (candidate) => {
      try {
        const req = { ...request, model: candidate.model };
        for await (const event of candidate.adapter.stream(req, abortController.signal)) {
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
    currentAbortController = null;

    if (!outcome.ok) {
      const message = 'refused' in outcome ? 'No AI provider is configured.' : outcome.failure.message;
      emit('zappr:done', { success: false, filesChanged: [], error: message });
      return { ok: false, error: message };
    }
    if (cancelled) return { ok: false, error: 'Cancelled.' };

    emit('zappr:done', { success: true, filesChanged: [], chatResponse: outcome.value });
    return { ok: true };
  }

  async function runFileMode(prompt: string): Promise<{ ok: boolean; error?: string }> {
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
    const abortController = new AbortController();
    currentAbortController = abortController;
    // Reuses the same orchestrator (provider resolution + failover) every other AI feature routes
    // through — 'explain' is the closest existing routing profile for a freeform-text task (there
    // is no 'proceed' TaskProfile — the enum is only 'repair' | 'explain' | 'test'). Zappr has no
    // verification/repair contract, so it does not go through ai-service.ts's AiService.run().
    const outcome = await orchestrator.run('explain', async (candidate) => {
      try {
        const req = { ...request, model: candidate.model };
        for await (const event of candidate.adapter.stream(req, abortController.signal)) {
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
    currentAbortController = null;

    if (!outcome.ok) {
      const message = 'refused' in outcome ? 'No AI provider is configured.' : outcome.failure.message;
      return { ok: false, error: message };
    }
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
          emit('zappr:fileProgress', {
            filePath: step.filePath,
            content: step.content ?? '',
            index: i,
            total: plan.steps.length,
          });
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
