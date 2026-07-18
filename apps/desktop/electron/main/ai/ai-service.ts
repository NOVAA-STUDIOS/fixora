import {
  buildContext,
  createOpenRouterProvider,
  DEFAULT_BUDGETS,
  parseRepairOutput,
  parseTestOutput,
  prepareRequest,
  profileWantsStructuredOutput,
  type AIProvider,
  type ProviderMessage,
  type ProviderRequest,
} from '@fixora/core-ai';
import type { AiRunRequest, AiRunResponse, Language } from '@fixora/shared-types';
import type { BrowserWindow } from 'electron';

import type { FindingsRepository, RepairHistoryRepository } from '../db/repositories.js';
import { emitToWindow } from '../ipc/emit.js';
import { readTextFile } from '../services/fs/fs-service.js';
import type { WorkspaceService } from '../services/workspace-service.js';
import type { VerificationService } from '../verification/verification-service.js';

import type { KeyStore } from './key-store.js';

/**
 * The AI run orchestrator (AI-Pipeline). It is the only thing in main that talks to a provider, and it
 * does so BYOK — direct to OpenRouter with the user's key, never through a server. Every run is grounded
 * on a stored deterministic finding, built into a context, and passed through the secret gate before a
 * single byte leaves the machine. A repair is then **verified** on an overlay before it is shown, so the
 * proposal the user sees already carries its verdict (ADR-003).
 */

const EXT_LANGUAGE: Record<string, Language> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  go: 'go',
};

function languageFor(relPath: string): Language | null {
  const ext = relPath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANGUAGE[ext] ?? null;
}

export interface AiServiceDeps {
  keyStore: KeyStore;
  findings: FindingsRepository;
  workspace: WorkspaceService;
  verification: VerificationService;
  history: RepairHistoryRepository;
  /** Injected so tests can drive a fake provider; defaults to the real OpenRouter adapter. */
  providerFactory?: (key: string) => AIProvider;
  /** Injected for tests; defaults to the path-guarded, secret-denylisted reader. */
  readFile?: (rootPath: string, relPath: string) => string;
  appMeta?: { url?: string; name?: string };
}

export interface AiService {
  run(request: AiRunRequest, window: BrowserWindow | null): Promise<AiRunResponse>;
  cancel(): void;
}

type StreamResult = { ok: true; text: string } | { ok: false; message: string };

interface Target {
  symbolName: string | null;
  startLine: number;
  endLine: number;
}

const SCHEMA_ERROR = Symbol('schema_error');

export function createAiService(deps: AiServiceDeps): AiService {
  const makeProvider =
    deps.providerFactory ??
    ((key: string): AIProvider =>
      createOpenRouterProvider({
        apiKey: key,
        ...(deps.appMeta?.url !== undefined ? { appUrl: deps.appMeta.url } : {}),
        ...(deps.appMeta?.name !== undefined ? { appName: deps.appMeta.name } : {}),
      }));

  const readFile = deps.readFile ?? ((root: string, rel: string) => readTextFile(root, rel).content);

  let active: AbortController | null = null;

  async function streamOnce(
    provider: AIProvider,
    request: ProviderRequest,
    signal: AbortSignal,
    window: BrowserWindow | null,
    emitDeltas: boolean,
  ): Promise<StreamResult> {
    let text = '';
    for await (const event of provider.stream(request, signal)) {
      if (event.type === 'text_delta') {
        text += event.text;
        if (emitDeltas && window !== null) emitToWindow(window, 'ai:delta', { text: event.text });
      } else if (event.type === 'error') {
        return { ok: false, message: `Provider error (${event.providerCode}).` };
      }
    }
    return { ok: true, text };
  }

  function reAskRequest(request: ProviderRequest, previous: string): ProviderRequest {
    const messages: ProviderMessage[] = [
      ...request.messages,
      { role: 'assistant', content: previous },
      {
        role: 'user',
        content:
          'Your previous response was not valid JSON matching the required schema. ' +
          'Return ONLY the JSON object, with no surrounding text.',
      },
    ];
    return { ...request, messages };
  }

  return {
    cancel() {
      active?.abort();
      active = null;
    },

    async run(request, window): Promise<AiRunResponse> {
      const key = deps.keyStore.getKey();
      if (key === null) {
        return { status: 'error', code: 'no_key', message: 'Add your provider key in Settings → AI.' };
      }
      const workspace = deps.workspace.getCurrent();
      if (workspace === null) {
        return { status: 'error', code: 'not_found', message: 'Open a workspace first.' };
      }
      const finding = deps.findings.getByFindingId(workspace.id, request.findingId);
      if (finding === null) {
        return { status: 'error', code: 'not_found', message: 'That finding is no longer available.' };
      }
      const language = languageFor(finding.location.file);
      if (language === null) {
        return { status: 'error', code: 'not_found', message: 'Unsupported file type for AI actions.' };
      }

      let content: string;
      try {
        content = readFile(workspace.rootPath, finding.location.file);
      } catch {
        return { status: 'error', code: 'not_found', message: 'Could not read the file.' };
      }

      const symbol = finding.evidence.enclosingSymbol;
      const target: Target = symbol
        ? { symbolName: symbol.name, startLine: symbol.location.startLine, endLine: symbol.location.endLine }
        : { symbolName: null, startLine: finding.location.startLine, endLine: finding.location.endLine };

      const context = buildContext({
        filePath: finding.location.file,
        language,
        fileContent: content,
        finding,
        target,
        conventions: [`Language: ${language}`],
        budget: DEFAULT_BUDGETS[request.profile],
      });

      const prepared = prepareRequest(request.profile, context, {
        model: deps.keyStore.getConfig().model,
        maxOutputTokens: DEFAULT_BUDGETS[request.profile].reserveForOutput,
      });
      if (!prepared.ok) {
        if (window !== null) emitToWindow(window, 'ai:runState', { status: 'blocked' });
        return { status: 'blocked', matches: prepared.blocked.map((m) => ({ ...m })) };
      }

      const controller = new AbortController();
      active?.abort();
      active = controller;
      if (window !== null) emitToWindow(window, 'ai:runState', { status: 'running' });

      const provider = makeProvider(key);
      const wantsStructured = profileWantsStructuredOutput(request.profile);

      // Turn a raw completion into a response. `repair` verifies on an overlay before returning; a
      // schema violation returns the SCHEMA_ERROR sentinel so run() can re-ask exactly once.
      const finalize = async (text: string): Promise<AiRunResponse | typeof SCHEMA_ERROR> => {
        if (request.profile === 'explain') {
          return { status: 'ok', proposal: { profile: 'explain', explanation: text } };
        }
        if (request.profile === 'test') {
          const parsed = parseTestOutput(text);
          if (!parsed.ok) return SCHEMA_ERROR;
          return {
            status: 'ok',
            proposal: {
              profile: 'test',
              framework: parsed.value.framework,
              testCode: parsed.value.testCode,
              rationale: parsed.value.rationale,
            },
          };
        }
        const parsed = parseRepairOutput(text);
        if (!parsed.ok) return SCHEMA_ERROR;
        const { report, originalCode } = await deps.verification.verify({
          finding,
          repairedCode: parsed.value.repairedCode,
          target: {
            file: finding.location.file,
            startLine: target.startLine,
            endLine: target.endLine,
            language,
          },
          workspaceRoot: workspace.rootPath,
          originalContent: content,
          originalFindings: deps.findings.list(workspace.id, { relPath: finding.location.file }),
        });
        // Record every reviewed repair in the local audit trail (Beta Phase E), whatever the verdict —
        // an unresolved or regressed attempt is part of the history too. Apply stamps it later.
        const historyId = deps.history.record({
          workspaceId: workspace.id,
          findingId: finding.id,
          relPath: finding.location.file,
          symbolName: target.symbolName,
          ruleId: finding.ruleId,
          source: finding.source,
          verdict: report.verdict,
          rationale: parsed.value.rationale,
          originalCode,
          repairedCode: parsed.value.repairedCode,
          model: deps.keyStore.getConfig().model,
          confidence: parsed.value.confidence,
          startLine: target.startLine,
          endLine: target.endLine,
        });
        return {
          status: 'ok',
          proposal: {
            profile: 'repair',
            historyId,
            repairedCode: parsed.value.repairedCode,
            originalCode,
            rationale: parsed.value.rationale,
            confidence: parsed.value.confidence,
            target: {
              file: finding.location.file,
              startLine: target.startLine,
              endLine: target.endLine,
              symbolName: target.symbolName,
            },
            verification: report,
          },
        };
      };

      try {
        let stream = await streamOnce(provider, prepared.request, controller.signal, window, !wantsStructured);
        if (controller.signal.aborted) return { status: 'error', code: 'cancelled', message: 'Cancelled.' };
        if (!stream.ok) {
          if (window !== null) emitToWindow(window, 'ai:runState', { status: 'error', message: stream.message });
          return { status: 'error', code: 'provider_error', message: stream.message };
        }

        let response = await finalize(stream.text);
        if (response === SCHEMA_ERROR && wantsStructured) {
          stream = await streamOnce(
            provider,
            reAskRequest(prepared.request, stream.text),
            controller.signal,
            window,
            false,
          );
          if (stream.ok) response = await finalize(stream.text);
        }
        if (response === SCHEMA_ERROR) {
          if (window !== null) emitToWindow(window, 'ai:runState', { status: 'error' });
          return { status: 'error', code: 'schema_error', message: 'The model returned an invalid response.' };
        }

        if (window !== null) {
          emitToWindow(window, 'ai:runState', {
            status: response.status === 'ok' ? 'done' : 'error',
            ...(response.status === 'error' ? { message: response.message } : {}),
          });
        }
        return response;
      } finally {
        if (active === controller) active = null;
      }
    },
  };
}
