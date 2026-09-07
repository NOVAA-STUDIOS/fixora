import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

import { describeProviderFailure, type ProviderRequest } from '@fixora/core-ai';
import type { EventChannel, EventPayloadOf, ZapprAction, ZapprStep } from '@fixora/shared-types';
import type { BrowserWindow } from 'electron';
import log from 'electron-log';

import type { Orchestrator } from '../ai/providers/orchestrator.js';
import { emitToWindow } from '../ipc/emit.js';

import { deletePath, listDirectory, readTextFile, writeWorkspaceFile } from './fs/fs-service.js';
import type { WorkspaceService } from './workspace-service.js';

const MAX_CONTEXT_FILES = 20;
const ZAPPR_MODEL_MAX_TOKENS = 12000;
const ACTIVE_FILE_MAX_LINES = 200;

interface ZapprContext {
  workspaceRoot: string;
  projectName: string;
  activeFile: string | null;
  activeFileContent: string | null;
  openTabs: string[];
  /** No diagnostics store is reachable from main today — left empty rather than fabricated. */
  recentErrors: string[];
  gitBranch: string | null;
  platform: NodeJS.Platform;
}

/** Best-effort — a request with no active file/tabs still gets project + git context. */
function buildZapprContext(
  rootPath: string,
  activeFile: string | null,
  openTabs: string[],
): ZapprContext {
  let activeFileContent: string | null = null;
  if (activeFile !== null) {
    try {
      const lines = readTextFile(rootPath, activeFile).content.split('\n');
      activeFileContent =
        lines.length > ACTIVE_FILE_MAX_LINES
          ? `${lines.slice(0, ACTIVE_FILE_MAX_LINES).join('\n')}\n// ... (truncated, ${String(lines.length - ACTIVE_FILE_MAX_LINES)} more lines)`
          : lines.join('\n');
    } catch {
      activeFileContent = null;
    }
  }

  let gitBranch: string | null;
  try {
    gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: rootPath, timeout: 2000 })
      .toString()
      .trim();
  } catch {
    gitBranch = null;
  }

  return {
    workspaceRoot: rootPath,
    projectName: basename(rootPath),
    activeFile,
    activeFileContent,
    openTabs: openTabs.slice(0, 10),
    recentErrors: [],
    gitBranch,
    platform: process.platform,
  };
}

/** Only non-empty fields are included, so an empty-workspace request doesn't pad the prompt. */
function buildContextBlock(ctx: ZapprContext): string {
  const lines: string[] = [`- Project: ${ctx.projectName}`];
  if (ctx.gitBranch !== null) lines.push(`- Git branch: ${ctx.gitBranch}`);
  if (ctx.activeFile !== null) lines.push(`- Active file: ${ctx.activeFile}`);
  if (ctx.openTabs.length > 0) lines.push(`- Open tabs: ${ctx.openTabs.join(', ')}`);
  if (ctx.recentErrors.length > 0) lines.push(`- Recent errors:\n${ctx.recentErrors.join('\n')}`);
  let block = `CONTEXT:\n${lines.join('\n')}\n`;
  if (ctx.activeFileContent !== null) {
    block += `\nActive file content (${ctx.activeFile ?? ''}):\n\`\`\`\n${ctx.activeFileContent}\n\`\`\`\n`;
  }
  return block;
}

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

  const shortcutTrigger = /(shortcut|keybind|hotkey|bind\s|shortcut for|set\s+ctrl|set\s+alt)/i;
  if (shortcutTrigger.test(prompt)) {
    const keyMatch =
      /((?:ctrl|cmd|meta|alt|shift)(?:\s*\+\s*(?:ctrl|cmd|meta|alt|shift))*\s*\+\s*[a-z0-9])/i.exec(prompt);
    if (keyMatch?.[1] !== undefined) {
      const rawParts = keyMatch[1].split('+').map((p) => p.trim());
      const keys = rawParts
        .map((p, i) => (i === rawParts.length - 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()))
        .join('+');

      const intentMatch = /(?:to|for)\s+(.+)$/i.exec(prompt);
      const intent = (intentMatch?.[1] ?? '').trim().toLowerCase();

      // Real Fixora command ids (registry.ts / use-app-commands.ts) — not fabricated VSCode-style
      // ids. Most everyday intents (build, format, save, close tab) have no matching command here
      // yet, so they fall through to `unresolved` rather than being mapped to something wrong.
      const COMMAND_MAP: Record<string, { commandId: string; description: string }> = {
        'open terminal': { commandId: 'terminal.toggle', description: 'Toggle terminal' },
        terminal: { commandId: 'terminal.toggle', description: 'Toggle terminal' },
        search: { commandId: 'view.search', description: 'Open search' },
        find: { commandId: 'view.search', description: 'Open search' },
        settings: { commandId: 'view.settings', description: 'Open settings' },
      };
      const mappedKey = Object.keys(COMMAND_MAP).find((k) => intent.includes(k));
      if (mappedKey !== undefined) {
        const mapped = COMMAND_MAP[mappedKey];
        if (mapped !== undefined) {
          return { type: 'create_shortcut', keys, commandId: mapped.commandId, description: mapped.description, unresolved: false };
        }
      }
      return {
        type: 'create_shortcut',
        keys,
        commandId: intent !== '' ? intent : 'unknown',
        description: intent !== '' ? intent : 'Unknown command',
        unresolved: true,
      };
    }
  }

  if (/run\s+analysis|analyze\s+code|check\s+errors/i.test(prompt)) return { type: 'run_analysis' };

  const keyTrigger = /(api\s*key|apikey|set\s*key|change\s*key|update\s*key|set\s+my|change\s+my)/i;
  if (keyTrigger.test(prompt)) {
    const KNOWN_PROVIDERS = ['openrouter', 'gemini', 'openai', 'anthropic', 'groq', 'azure', 'ollama'];
    const keyCandidate = prompt
      .split(/\s+/)
      .reverse()
      .find((w) => w.length > 10 && /^[A-Za-z0-9_-]+$/.test(w));
    if (keyCandidate !== undefined) {
      const lower = prompt.toLowerCase();
      const provider = KNOWN_PROVIDERS.find((id) => lower.includes(id)) ?? '';
      return { type: 'update_api_key', provider, apiKey: keyCandidate };
    }
  }

  const terminalKeywords = [
    'run ', 'execute ', 'npm ', 'yarn ', 'pnpm ', 'git ', 'node ', 'python ',
    'pip ', 'tsc ', 'build ', 'install ', 'start ', 'test ',
  ];
  const p = prompt.toLowerCase();
  if (terminalKeywords.some((kw) => p.includes(kw))) {
    const command = prompt.trim().replace(/^(run|execute)\s+/i, '');
    return { type: 'run_terminal_command', command };
  }

  return { type: 'none' };
}

function buildChatPrompt(userPrompt: string, workspaceName: string, contextBlock: string): string {
  return `${contextBlock}
You are Zappr — the Jarvis of coding IDEs. You are brilliant, witty, and incredibly capable. You help with ANYTHING instantly.

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
  run(prompt: string, activeFile: string | null, openTabs: string[]): Promise<{ ok: boolean; error?: string }>;
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

function buildSystemPrompt(workspaceName: string, files: string[], userPrompt: string, contextBlock: string): string {
  return `${contextBlock}
You are Zappr — an elite AI coding agent built into Fixora. You are fast, precise, and produce production-quality code instantly.

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
6. If editing, include the ENTIRE file with your changes merged in, not a diff
7. You can create or edit multiple files at once — add one step per file to "steps"
8. Max 5 files (steps) per request

RESPONSE FORMAT (exact):
{"summary":"One sentence — what you're building","steps":[{"type":"create|edit|delete","filePath":"src/example.tsx","description":"What this file does","content":"full file content here"}]}

CRITICAL: Your response must be ONLY valid JSON.
No markdown, no backticks, no code fences.
File content goes inside the "content" string — escape all quotes with \\" and newlines with \\n

Think step by step, then respond with ONLY the JSON.`;
}

/** Best-effort JSON extraction — the model may wrap the object in prose or markdown fences
 *  despite being asked not to. */
function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();

  const start = cleaned.search(/[{[]/);
  const lastBrace = cleaned.lastIndexOf('}');
  const lastBracket = cleaned.lastIndexOf(']');
  const end = Math.max(lastBrace, lastBracket);

  if (start === -1 || end === -1) {
    log.error('[zappr] JSON parse failed — no JSON object found', { raw: text.slice(0, 200) });
    throw new Error(`Zappr JSON parse failed. Raw: ${text.slice(0, 200)}`);
  }

  const sliced = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(sliced);
  } catch {
    try {
      return JSON.parse(sliced.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      log.error('[zappr] JSON parse failed', { raw: text.slice(0, 200) });
      throw new Error(`Zappr JSON parse failed. Raw: ${text.slice(0, 200)}`);
    }
  }
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

  async function run(
    prompt: string,
    activeFile: string | null,
    openTabs: string[],
  ): Promise<{ ok: boolean; error?: string }> {
    cancelled = false;
    log.debug('[Zappr] Request received', { message: prompt.slice(0, 100), workspaceRoot: workspace.getCurrent()?.rootPath ?? null });

    const action = detectAction(prompt);
    log.debug('[Zappr] Action detected', { action: action.type });
    if (action.type !== 'none') {
      emit('zappr:actionResult', {
        ok: true,
        message: `On it! Executing: ${action.type}`,
        action,
      });
    }

    const mode = detectMode(prompt);
    log.debug('[Zappr] Mode detected', { mode });
    emit('zappr:mode', { mode });

    if (mode === 'file') return runFileMode(prompt, activeFile, openTabs);
    return runChatMode(prompt, activeFile, openTabs);
  }

  async function runChatMode(
    prompt: string,
    activeFile: string | null,
    openTabs: string[],
  ): Promise<{ ok: boolean; error?: string }> {
    const open = workspace.getCurrent();
    const workspaceName = open?.name ?? 'No project';
    const contextBlock = buildContextBlock(
      open === null
        ? { workspaceRoot: '', projectName: workspaceName, activeFile: null, activeFileContent: null, openTabs: [], recentErrors: [], gitBranch: null, platform: process.platform }
        : buildZapprContext(open.rootPath, activeFile, openTabs),
    );

    const request: ProviderRequest = {
      model: '',
      messages: [{ role: 'user', content: buildChatPrompt(prompt, workspaceName, contextBlock) }],
      maxOutputTokens: ZAPPR_MODEL_MAX_TOKENS,
    };

    let fullText = '';
    const abortController = new AbortController();
    currentAbortController = abortController;
    const outcome = await orchestrator.run('explain', async (candidate) => {
      log.debug('[Zappr] Calling AI', { provider: candidate.provider, model: candidate.model, promptLength: request.messages[0]?.content.length ?? 0 });
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
        log.debug('[Zappr] AI raw response', { raw: fullText.slice(0, 300) });
        return { ok: true, value: fullText };
      } catch (error) {
        log.error('[Zappr] ERROR', { error: String(error), stack: error instanceof Error ? error.stack?.slice(0, 500) : undefined });
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

  async function runFileMode(
    prompt: string,
    activeFile: string | null,
    openTabs: string[],
  ): Promise<{ ok: boolean; error?: string }> {
    const open = workspace.getCurrent();
    if (open === null) return { ok: false, error: 'No project is open.' };

    const files = await listContextFiles(open.rootPath, workspace);
    const contextBlock = buildContextBlock(buildZapprContext(open.rootPath, activeFile, openTabs));
    const systemPrompt = buildSystemPrompt(open.name, files, prompt, contextBlock);

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
      log.debug('[Zappr] Calling AI', { provider: candidate.provider, model: candidate.model, promptLength: request.messages[0]?.content.length ?? 0 });
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
        log.debug('[Zappr] AI raw response', { raw: fullText.slice(0, 300) });
        return { ok: true, value: fullText };
      } catch (error) {
        log.error('[Zappr] ERROR', { error: String(error), stack: error instanceof Error ? error.stack?.slice(0, 500) : undefined });
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
      log.debug('[Zappr] Parsed JSON', { parsed: JSON.stringify(parsed).slice(0, 300) });
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
      log.error('[Zappr] ERROR', { error: String(error), stack: error instanceof Error ? error.stack?.slice(0, 500) : undefined });
      return {
        ok: false,
        error: `Zappr's response wasn't valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    if (plan.steps.length > 5) {
      return { ok: false, error: `Zappr planned ${String(plan.steps.length)} files, but the max is 5 per request.` };
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
          log.debug('[Zappr] Writing file', { path: step.filePath });
          writeWorkspaceFile(open.rootPath, step.filePath, step.content ?? '');
        }
        filesChanged.push(step.filePath);
        emit('zappr:stepDone', { index: i, success: true });
      } catch (error) {
        log.error('[Zappr] ERROR', { error: String(error), stack: error instanceof Error ? error.stack?.slice(0, 500) : undefined });
        emit('zappr:stepDone', {
          index: i,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- can flip mid-loop via cancel()
    const doneMessage = cancelled ? undefined : `${String(filesChanged.length)} file${filesChanged.length === 1 ? '' : 's'} written successfully`;
    emit('zappr:done', { success: !cancelled, filesChanged, chatResponse: doneMessage });
    return { ok: true };
  }

  return { run, cancel, getContext };
}
