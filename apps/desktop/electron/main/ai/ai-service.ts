import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildContext,
  buildReAskMessage,
  describeModelOutputFailure,
  describeProviderFailure,
  describeSchemaFailureForUser,
  estimateComplexity,
  DEFAULT_BUDGETS,
  parseRepairOutput,
  parseTestOutput,
  prepareRequest,
  profileWantsStructuredOutput,
  type ProviderFailure,
  type ProviderMessage,
  type ProviderRequest,
  type AIProvider,
} from '@fixora/core-ai';
import { groupByRootCause, type MicroRepairResult, type RootCauseGroup } from '@fixora/core-analysis';
import { isUserFacingError } from '@fixora/shared-types';
import type {
  AiRunRequest,
  AiRunResponse,
  AiRunStage,
  Finding,
  Language,
  RepairHistoryAttempt,
  RepairMode,
  RepairSummary,
  RepairSummaryEntry,
  RootCauseInfo,
} from '@fixora/shared-types';
import { app, type BrowserWindow } from 'electron';

import type { FindingsRepository, RepairHistoryRepository } from '../db/repositories.js';
import { emitToWindow } from '../ipc/emit.js';
import { readTextFile } from '../services/fs/fs-service.js';
import type { WorkspaceService } from '../services/workspace-service.js';
import { spliceLines } from '../verification/patch.js';
import type { VerificationService } from '../verification/verification-service.js';

import { logProviderFailure, missingKeyFailure, toWireFailure } from './failure-report.js';
import type { KeyStore } from './key-store.js';
import type { ChainRefusal, Orchestrator } from './providers/orchestrator.js';
import { projectConventions, repairNeighbours } from './repair-context.js';
import { evaluateRepairEligibility } from './repair-eligibility.js';
import { RepairTraceBuilder } from './repair-trace.js';

/**
 * The AI run orchestrator (AI-Pipeline). It is the only thing in main that talks to a provider, and it
 * does so BYOK — direct to OpenRouter with the user's key, never through a server. Every run is grounded
 * on a stored deterministic finding, built into a context, and passed through the secret gate before a
 * single byte leaves the machine. A repair is then **verified** on an overlay before it is shown, so the
 * proposal the user sees already carries its verdict (ADR-003).
 */

// Kept in sync with `packages/core-analysis/src/language.ts`'s `EXTENSION_LANGUAGE` by hand, not by
// import: that package is ESM (tree-sitter-WASM) and cannot be `require`d into this CJS main process
// (see the `deterministicRepair` comment below — the same constraint routes that call through the
// analysis worker instead). A prior drift here (missing `pyi`/`json`) meant a file the Analyzer
// happily produced findings for was rejected by Repair/Proceed as "unsupported" — bug-fix sprint,
// Phase 1: this map must list every extension `languageForPath` does, or that gap reopens silently.
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
  pyi: 'python',
  go: 'go',
  json: 'json',
  css: 'css',
  html: 'html',
  htm: 'html',
};

/** Path → language. Exported so Proceed Mode uses the SAME mapping the repair path does. */
export function languageFor(relPath: string): Language | null {
  const ext = relPath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANGUAGE[ext] ?? null;
}

export interface AiServiceDeps {
  keyStore: KeyStore;
  findings: FindingsRepository;
  workspace: WorkspaceService;
  verification: VerificationService;
  history: RepairHistoryRepository;
  /**
   * Decides which provider answers, in the user's priority order, and owns failover.
   *
   * The service no longer constructs a provider at all: it asks for text and gets text. That is what
   * keeps the repair pipeline provider-blind now that there is more than one to choose between.
   */
  orchestrator: Orchestrator;
  /** Injected for tests; defaults to the path-guarded, secret-denylisted reader. */
  readFile?: (rootPath: string, relPath: string) => string;
  /**
   * Q2 Fix #2A: apply a tool-authored autofix (ESLint's `fix`, Ruff's edits) for a `safe-auto`
   * finding. Routed through the analysis worker — same reason `resolveScope` is — because
   * `deterministicRepair` depends on the ESM + tree-sitter-WASM engine, which cannot load in this
   * (CJS) process. Required, not defaulted: there is no safe in-main implementation to fall back to.
   */
  microRepair: (input: {
    finding: Finding;
    source: string;
    language: Language;
    filePath: string;
  }) => Promise<MicroRepairResult | null>;
  appMeta?: { url?: string; name?: string };
}

/**
 * What the user is told when there is nothing to try.
 *
 * Three causes with three different fixes. Collapsing them into "no key configured" — which is what
 * a single-provider world could get away with — would send a user with a perfectly good key to
 * re-enter it because their only enabled provider could not do structured output.
 */
const CHAIN_REFUSAL_MESSAGE: Record<ChainRefusal, string> = {
  'none-enabled':
    'No AI provider is enabled yet. Turn one on in Settings to use AI repairs — analysis works without one.',
  'no-credentials':
    'Your enabled AI providers have no API key yet. Add a key in Settings to use AI repairs.',
  'no-capable-provider':
    'None of your enabled providers can produce a structured repair with their selected model. Choose a different model in Settings.',
};

export interface AiService {
  run(request: AiRunRequest, window: BrowserWindow | null): Promise<AiRunResponse>;
  cancel(): void;
}

type StreamResult =
  | { ok: true; text: string }
  /**
   * The failure travels classified, not as a sentence. The service used to keep only `message` and
   * `retryable`, which meant every caller that wanted to say *what kind* of failure it was had to
   * re-derive it from the prose — or, in practice, not say at all.
   */
  | { ok: false; message: string; retryable: boolean; failure: ProviderFailure };

interface Target {
  symbolName: string | null;
  startLine: number;
  endLine: number;
}

const SCHEMA_ERROR = Symbol('schema_error');

/**
 * The last parse failure, so run() can report the real reason instead of a generic sentence.
 * Set by finalize(), read once by run().
 */
type ParseFailureInfo = {
  reason: string;
  detail: string;
  recovery: readonly string[];
  text: string;
};

/**
 * What the patch fixed and what it left alone, for the panel's Repair Summary.
 *
 * `skipped` is the part that matters: a minimal patch that silently leaves other problems in the file
 * untouched looks identical to one that missed them. Naming each skipped problem with its reason is
 * what makes minimality read as a deliberate choice rather than an incomplete job.
 */
function buildRepairSummary(input: {
  finding: Finding;
  related: readonly Finding[];
  others: readonly Finding[];
}): RepairSummary {
  const entry = (f: Finding, reason?: string): RepairSummaryEntry => ({
    ruleId: f.ruleId,
    line: f.location.startLine,
    message: f.message,
    ...(reason !== undefined ? { reason } : {}),
  });
  return {
    fixed: [entry(input.finding)],
    related: input.related.map((f) => entry(f)),
    skipped: input.others.map((f) =>
      entry(
        f,
        f.repair === 'manual'
          ? 'Needs your judgment — no automatic or AI fix exists for this rule.'
          : 'Outside the repair scope. Repair it separately to keep this patch minimal.',
      ),
    ),
  };
}

/** The Root Cause View (Advanced Repair only) — null when the mode is anything else. */
function buildRootCauseInfo(input: {
  mode: RepairMode;
  selected: Finding;
  group: RootCauseGroup | null;
}): RootCauseInfo | undefined {
  if (input.mode !== 'advanced' || input.group === null) return undefined;
  const { rootCause, affected } = input.group;
  return {
    basis: input.group.basis,
    ruleId: rootCause.ruleId,
    message: rootCause.message,
    line: rootCause.location.startLine,
    differsFromSelection: rootCause.id !== input.selected.id,
    affected: affected.map((f) => ({ ruleId: f.ruleId, line: f.location.startLine, message: f.message })),
  };
}

export function createAiService(deps: AiServiceDeps): AiService {
  const orchestrator = deps.orchestrator;

  const readFile =
    deps.readFile ?? ((root: string, rel: string) => readTextFile(root, rel).content);

  let active: AbortController | null = null;

  async function streamOnce(
    provider: AIProvider,
    request: ProviderRequest,
    signal: AbortSignal,
    window: BrowserWindow | null,
    emitDeltas: boolean,
  ): Promise<StreamResult> {
    let text = '';
    const startedAt = Date.now();
    for await (const event of provider.stream(request, signal)) {
      if (event.type === 'text_delta') {
        text += event.text;
        if (emitDeltas && window !== null) emitToWindow(window, 'ai:delta', { text: event.text });
      } else if (event.type === 'error') {
        // Classified, not echoed (P2.2.1). The raw string — "429 Too Many Requests — Rate limit
        // exceeded: free-models-per-day…" — is correct for a log and useless in a panel. Repair and
        // Proceed share this classifier so they can never disagree about what a 429 means, or
        // whether it's worth retrying. The provider's own words are an INPUT to the classification
        // (they are what separates a throttle from an exhausted quota) and never an output.
        const failure = describeProviderFailure({
          providerCode: event.providerCode,
          detail: event.message,
          retryable: event.retryable,
        });
        // The diagnostic half, to the developer log only: status, request id, latency, the raw text.
        // Never the key and never the payload.
        logProviderFailure(failure, {
          provider: 'openrouter',
          model: request.model,
          status: event.status,
          errorCode: event.providerCode,
          latencyMs: Date.now() - startedAt,
          requestId: event.requestId,
          retryable: failure.retryable,
          detail: event.message,
        });
        return {
          ok: false,
          message: failure.message,
          retryable: failure.retryable,
          failure,
        };
      }
    }
    return { ok: true, text };
  }

  function reAskRequest(
    request: ProviderRequest,
    previous: string,
    failure: ParseFailureInfo | null,
  ): ProviderRequest {
    const messages: ProviderMessage[] = [
      ...request.messages,
      { role: 'assistant', content: previous },
      {
        role: 'user',
        content: buildReAskMessage(failure ?? { reason: 'unknown', detail: '' }),
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
      /**
       * Report which phase the run is in. A repair is several seconds of work across context
       * assembly, the provider, and the verification worker; emitting all of it as one "running"
       * made a slow repair indistinguishable from a hung one, for the user and for a bug report
       * alike. Fire-and-forget by design — progress reporting must never be able to fail a run.
       */
      const stage = (name: AiRunStage): void => {
        if (window !== null)
          emitToWindow(window, 'ai:runState', { status: 'running', stage: name });
      };

      stage('preparing');
      const modelId = deps.keyStore.getConfig().model;
      const key = deps.keyStore.getKey();
      if (key === null) {
        return {
          status: 'error',
          code: 'no_key',
          message:
            'Fixora has no provider key yet, so it cannot reach an AI model. Add your key in Settings → AI.',
          // A configuration failure, and the one the card explains best — it is fixable in one click.
          failure: missingKeyFailure(modelId),
        };
      }
      const workspace = deps.workspace.getCurrent();
      if (workspace === null) {
        return { status: 'error', code: 'not_found', message: 'Open a workspace first.' };
      }
      const finding = deps.findings.getByFindingId(workspace.id, request.findingId);
      if (finding === null) {
        return {
          status: 'error',
          code: 'not_found',
          message: 'That finding is no longer available.',
        };
      }
      stage('analyzing');
      const language = languageFor(finding.location.file);
      if (language === null) {
        return {
          status: 'error',
          code: 'not_found',
          // Same wording Proceed uses for the identical condition (`proceed-service.ts`) — a
          // bug-fix-sprint fix: these used to read differently for the same underlying cause.
          message: "This file type isn't supported for AI actions yet.",
        };
      }

      // Repair eligibility (P0.1 Part 2): decide, with a precise reason, whether this finding can be
      // repaired at all — before any model call. Availability depends only on language, rule and model
      // (Part 4), never on the workspace. Model capability is enforced downstream by the provider/
      // schema path, so here it is not pre-judged (repairCapable: true); the language and manual-rule
      // decisions ARE final and short-circuit with the engine's exact reason, never a generic one.
      let repairMethod: 'deterministic' | 'ai' | null = null;
      if (request.profile === 'repair') {
        const eligibility = evaluateRepairEligibility({
          language,
          ruleId: finding.ruleId,
          repairability: finding.repair,
          provider: 'openrouter',
          model: deps.keyStore.getConfig().model,
          repairCapable: true,
        });
        if (!eligibility.repairable && eligibility.reason !== null) {
          console.error('[ai:run] repair not eligible', {
            ruleId: finding.ruleId,
            repairability: finding.repair,
            reason: eligibility.reason,
          });
          return { status: 'error', code: 'not_found', message: eligibility.reason };
        }
        repairMethod = eligibility.method;
      }

      let content: string;
      try {
        content = readFile(workspace.rootPath, finding.location.file);
      } catch (error) {
        // The fs layer authors a precise, actionable reason — "no longer exists", "open in another
        // program", "permission denied", "on the secrets denylist". Surface THAT verbatim, never a
        // vague "could not read the file", so the user learns exactly why the repair cannot proceed
        // and how to fix it (P0 Priority 1: explain exactly why, never hide behind a generic string).
        const message = isUserFacingError(error)
          ? error.message
          : `Could not read ${finding.location.file}. It may have been moved, renamed, or had its permissions changed since analysis — re-run analysis and try again.`;
        console.error('[ai:run] file read failed', {
          file: finding.location.file,
          authored: isUserFacingError(error),
          message,
        });
        return { status: 'error', code: 'not_found', message };
      }

      // Deterministic micro-repair (Q2 Fix #2A): a tool-authored autofix (finding.repair ===
      // 'safe-auto') needs no model at all — `evaluateRepairEligibility` already computes
      // `method: 'deterministic'` for it. Runs `deterministicRepair` in the analysis worker (Q2 Fix
      // #2 proved a direct import of `@fixora/core-analysis` into this CJS main process throws
      // `ERR_REQUIRE_ESM`), then feeds the result through the SAME `verify()` gate and `AiProposal`
      // shape the AI path uses below — nothing downstream (history, the client-side apply gate, the
      // UI) needs to know a model was never called. Never falls through to AI on failure: a
      // `safe-auto` finding's repairability was decided by the analyzer, not by whether the model
      // pipeline happens to be reachable, so a failure here is a typed refusal, not a silent retry
      // with a different (unproven, unrequested) strategy.
      if (request.profile === 'repair' && repairMethod === 'deterministic') {
        let micro: MicroRepairResult | null;
        try {
          micro = await deps.microRepair({
            finding,
            source: content,
            language,
            filePath: finding.location.file,
          });
        } catch (error) {
          // A worker timeout/crash is a transport failure, not a verdict on the fix — typed the same
          // way every other failure in this block is, so the caller never has to distinguish "the
          // repair was unsafe" from "the process that would have computed it died".
          console.error('[ai:run] deterministic repair worker failed', {
            ruleId: finding.ruleId,
            message: error instanceof Error ? error.message : String(error),
          });
          return {
            status: 'error',
            code: 'not_found',
            message: `The automatic fix for ${finding.ruleId} could not be computed right now. Re-run analysis and try again.`,
          };
        }
        if (!micro?.parseOk) {
          console.error('[ai:run] deterministic repair could not be applied cleanly', {
            ruleId: finding.ruleId,
            hasAutofix: finding.autofix !== undefined,
            parseOk: micro?.parseOk ?? null,
          });
          return {
            status: 'error',
            code: 'not_found',
            message: `The automatic fix for ${finding.ruleId} could not be applied safely to this file.`,
          };
        }
        const lineCount = content.split(/\r?\n/).length;
        stage('validating');
        const { report, originalCode } = await deps.verification.verify({
          finding,
          repairedCode: micro.patched,
          target: { file: finding.location.file, startLine: 1, endLine: lineCount, language },
          workspaceRoot: workspace.rootPath,
          originalContent: content,
          originalFindings: deps.findings.list(workspace.id, { relPath: finding.location.file }),
        });
        const rationale = `Applied ${micro.source}'s own fix for ${finding.ruleId} — no model was used.`;
        const historyId = deps.history.record({
          workspaceId: workspace.id,
          findingId: finding.id,
          relPath: finding.location.file,
          symbolName: null,
          ruleId: finding.ruleId,
          source: finding.source,
          verdict: report.verdict,
          rationale,
          originalCode,
          repairedCode: micro.patched,
          model: null,
          confidence: 1,
          startLine: 1,
          endLine: lineCount,
        });
        if (window !== null) emitToWindow(window, 'ai:runState', { status: 'done' });
        return {
          status: 'ok',
          proposal: {
            profile: 'repair',
            historyId,
            // The deterministic path applies one tool-authored autofix and never merges: the edit is
            // the tool's own, and widening it would make it ours.
            mode: 'finding' as const,
            repairSummary: buildRepairSummary({
              finding,
              related: [],
              others: deps.findings
                .list(workspace.id, { relPath: finding.location.file })
                .filter((f) => f.id !== finding.id),
            }),
            repairedCode: micro.patched,
            originalCode,
            rationale,
            confidence: 1,
            target: {
              file: finding.location.file,
              startLine: 1,
              endLine: lineCount,
              symbolName: null,
            },
            verification: report,
          },
        };
      }

      // The repair target is the smallest self-contained AST scope the analyzer resolved for this
      // finding (Repair Context Engine v2): the least code that still parses independently and splices
      // safely. It is preferred over the whole enclosing symbol so a one-line fix does not regenerate
      // an entire function, and it is never a partial fragment (the TS2322-in-an-object-literal that
      // the parser rejected). The enclosing symbol still supplies the label; the finding's bare line is
      // a last resort, reached only when analysis produced no scope at all (e.g. the file did not
      // parse). enclosingRange is always >= a complete statement, so the target always compiles.
      const symbol = finding.evidence.enclosingSymbol;
      const scope = finding.evidence.enclosingRange;
      const target: Target = scope
        ? { symbolName: symbol?.name ?? null, startLine: scope.startLine, endLine: scope.endLine }
        : symbol
          ? {
              symbolName: symbol.name,
              startLine: symbol.location.startLine,
              endLine: symbol.location.endLine,
            }
          : {
              symbolName: null,
              startLine: finding.location.startLine,
              endLine: finding.location.endLine,
            };

      /**
       * Mode decides the SPLICE RANGE, and the splice range is the blast radius.
       *
       *  - `finding` / `related-scope` keep the resolved scope exactly. `related-scope` does not widen
       *    the patch; it only lets the same patch resolve everything already inside it. That is what
       *    makes the merge safe: minimality is unchanged, only thoroughness improves.
       *  - `ai-file` replaces the whole file. That is the largest edit the app can make, which is why
       *    it is advanced-only, warned before it runs, and never selected automatically.
       */
      const mode: RepairMode = request.mode ?? 'finding';
      const fileLineCount = content.split(/\r?\n/).length;

      // Every other finding in this file, split by whether it falls inside the patch range. Only
      // those inside can be fixed by this patch — anything outside would need a wider splice, which
      // is exactly what the mode ladder exists to keep the user in control of.
      const siblings = deps.findings
        .list(workspace.id, { relPath: finding.location.file })
        .filter((f) => f.id !== finding.id);

      // Advanced Repair: root-cause grouping (pure, no model call — see root-cause-grouping.ts).
      // Computed here, before `patchTarget`, because the group DECIDES the target for this mode —
      // the splice range is the root cause's own scope, possibly widened by its group, never the
      // whole file and never a union spanning independent scattered occurrences.
      const advancedGroup: RootCauseGroup | null =
        mode === 'advanced'
          ? (groupByRootCause([finding, ...siblings]).find(
              (g) =>
                g.rootCause.id === finding.id ||
                g.mergeable.some((f) => f.id === finding.id) ||
                g.affected.some((f) => f.id === finding.id),
            ) ?? null)
          : null;

      const patchTarget: Target =
        mode === 'ai-file'
          ? { symbolName: null, startLine: 1, endLine: fileLineCount }
          : mode === 'advanced' && advancedGroup !== null
            ? {
                symbolName: advancedGroup.rootCause.evidence.enclosingSymbol?.name ?? null,
                startLine: advancedGroup.targetRange.startLine,
                endLine: advancedGroup.targetRange.endLine,
              }
            : target;

      const withinPatch = (f: Finding): boolean =>
        f.location.startLine >= patchTarget.startLine &&
        f.location.startLine <= patchTarget.endLine;
      // `manual` findings are never merged in: the analyzer already judged that no machine should
      // guess them, and bundling one into a patch would launder that refusal.
      //
      // Advanced Repair uses the GROUP's own merge decision (root-cause-grouping.ts already applied
      // the manual exclusion, and — critically — the identifier/scope distinction that decides how
      // far a patch may safely widen) rather than the generic "anything on a line inside the range"
      // rule, which would sweep in loosely-adjacent findings the grouping deliberately did not vouch
      // for.
      const mergeable =
        mode === 'finding'
          ? []
          : mode === 'advanced'
            ? (advancedGroup?.mergeable ?? [])
            : siblings.filter((f) => withinPatch(f) && f.repair !== 'manual');
      const skipped = siblings.filter((f) => !mergeable.includes(f));

      // Manual Validation Phase 2 instrumentation. Observes only — every stage is recorded so a
      // rejected repair can be traced to the step that produced the wrong thing, rather than being
      // reported as a bare verdict.
      const trace = new RepairTraceBuilder(String(Date.now()), mode)
        .finding(finding, language)
        .target(patchTarget, content)
        .related(mergeable);

      // v3 context layers: the Semantic + Dependency neighbours the analyzer selected (sliced from the
      // current file), and the Project Metadata conventions detected from the project itself.
      const context = buildContext({
        filePath: finding.location.file,
        language,
        fileContent: content,
        finding,
        target: patchTarget,
        relatedFindings: mergeable,
        neighbours: repairNeighbours(content, finding),
        conventions: projectConventions({
          language,
          fileContent: content,
          workspaceRoot: workspace.rootPath,
        }),
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
      trace.prompt(prepared.request.messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n'));

      const controller = new AbortController();
      active?.abort();
      active = controller;
      stage('generating');

      const wantsStructured = profileWantsStructuredOutput(request.profile);
      // A ref rather than a `let`: finalize() assigns it from inside a closure, and TypeScript's
      // control-flow analysis cannot see that, so it narrows a plain `let` to `null` at every read.
      const lastFailure: { current: ParseFailureInfo | null } = { current: null };
      // Same ref pattern, same reason: `finalize` is defined before the walk runs, so it cannot see
      // `const`s the walk introduces later in the same function. Filled in once the walk resolves,
      // read inside `finalize` when it records history — Provider History (the final provider plus
      // what was tried before it).
      const usedCandidate: {
        current: { provider: string; model: string; attempts: RepairHistoryAttempt[] } | null;
      } = { current: null };

      // Turn a raw completion into a response. `repair` verifies on an overlay before returning; a
      // schema violation returns the SCHEMA_ERROR sentinel so run() can re-ask exactly once.
      const finalize = async (text: string): Promise<AiRunResponse | typeof SCHEMA_ERROR> => {
        if (request.profile === 'explain') {
          return { status: 'ok', proposal: { profile: 'explain', explanation: text } };
        }
        if (request.profile === 'test') {
          const parsed = parseTestOutput(text);
          if (!parsed.ok) {
            lastFailure.current = {
              reason: parsed.reason,
              detail: parsed.detail,
              recovery: parsed.recovery,
              text: parsed.text,
            };
            return SCHEMA_ERROR;
          }
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
        trace.rawResponse(text);
        const parsed = parseRepairOutput(text);
        if (!parsed.ok) {
          trace.parsed({ ok: false, reason: parsed.reason, detail: parsed.detail });
          lastFailure.current = {
            reason: parsed.reason,
            detail: parsed.detail,
            recovery: parsed.recovery,
            text: parsed.text,
          };
          return SCHEMA_ERROR;
        }
        trace.parsed({
          ok: true,
          repairedCode: parsed.value.repairedCode,
          rationale: parsed.value.rationale,
          confidence: parsed.value.confidence,
        });
        trace.spliced(
          spliceLines(
            content,
            patchTarget.startLine,
            patchTarget.endLine,
            parsed.value.repairedCode,
          ),
        );
        // Recovery is reported, never silent — that is the whole justification for unwrapping.
        if (parsed.recovery.length > 0 && parsed.recovery[0] !== 'none') {
          console.error('[ai] recovered model output', {
            profile: request.profile,
            model: prepared.request.model,
            recovery: parsed.recovery,
          });
        }
        stage('validating');
        const { report, originalCode } = await deps.verification.verify({
          finding,
          repairedCode: parsed.value.repairedCode,
          target: {
            file: finding.location.file,
            startLine: patchTarget.startLine,
            endLine: patchTarget.endLine,
            language,
          },
          workspaceRoot: workspace.rootPath,
          originalContent: content,
          originalFindings: deps.findings.list(workspace.id, { relPath: finding.location.file }),
        });
        trace.verified(report);
        // A rejected repair is exactly the case worth keeping evidence for. A verified one is not:
        // dumping source to disk on every success would be a privacy cost with no diagnostic return.
        if (report.verdict === 'regression' || !report.syntaxOk) {
          const tracePath = trace.write();
          console.error('[ai:run] REPAIR REJECTED — trace written', {
            ...trace.summary(),
            trace: tracePath,
          });
        }

        // Record every reviewed repair in the local audit trail (Beta Phase E), whatever the verdict —
        // an unresolved or regressed attempt is part of the history too. Apply stamps it later.
        const historyId = deps.history.record({
          workspaceId: workspace.id,
          findingId: finding.id,
          relPath: finding.location.file,
          symbolName: patchTarget.symbolName,
          ruleId: finding.ruleId,
          source: finding.source,
          verdict: report.verdict,
          rationale: parsed.value.rationale,
          originalCode,
          repairedCode: parsed.value.repairedCode,
          model: usedCandidate.current?.model ?? deps.keyStore.getConfig().model,
          provider: usedCandidate.current?.provider ?? null,
          attempts: usedCandidate.current?.attempts ?? [],
          confidence: parsed.value.confidence,
          startLine: patchTarget.startLine,
          endLine: patchTarget.endLine,
        });
        return {
          status: 'ok',
          proposal: {
            profile: 'repair',
            historyId,
            mode,
            // What this patch actually covered, and what it deliberately did not — each skip with a
            // reason, so a minimal patch reads as a choice rather than an oversight.
            repairSummary: buildRepairSummary({ finding, related: mergeable, others: skipped }),
            rootCause: buildRootCauseInfo({ mode, selected: finding, group: advancedGroup }),
            repairedCode: parsed.value.repairedCode,
            originalCode,
            rationale: parsed.value.rationale,
            confidence: parsed.value.confidence,
            target: {
              file: finding.location.file,
              startLine: patchTarget.startLine,
              endLine: patchTarget.endLine,
              symbolName: patchTarget.symbolName,
            },
            verification: report,
          },
        };
      };

      try {
        // Provider failover, now across PROVIDERS rather than models on one key. The chain is the
        // user's registry order, filtered to what is enabled, credentialed and capable; a candidate
        // that ANSWERS ends the walk, and everything downstream — parse, verify, Apply — is
        // unchanged and runs exactly once, on that answer.
        //
        // Smart model routing: a size/complexity hint for providers the user left on "auto". This
        // NEVER reorders providers and NEVER overrides a model the user actually picked — see
        // `orchestrator.ts`. Complexity is estimated from what is actually being sent, not guessed.
        const promptChars = prepared.request.messages.reduce((n, m) => n + m.content.length, 0);
        const routingTask = {
          // Advanced Repair is definitionally the complex case — it coordinates a root cause with
          // its group rather than a single finding — so complexity is never re-estimated down for
          // it, the same way a small file with one lint nit is.
          complexity:
            mode === 'advanced'
              ? ('high' as const)
              : estimateComplexity({
                  language,
                  contentChars: promptChars,
                  findingCount: mergeable.length + 1,
                }),
          estimatedTokens: Math.ceil(promptChars / 4),
        };

        const walk = await orchestrator.run(
          request.profile,
          async (candidate) => {
            const result = await streamOnce(
              candidate.adapter,
              // Same prepared request, this candidate's model. The budget was computed for the first
              // candidate; one with a smaller window answers `context-too-large`, which is not a
              // failover category, so the walk stops and reports it honestly rather than looping.
              { ...prepared.request, model: candidate.model },
              controller.signal,
              window,
              !wantsStructured,
            );
            return result.ok
              ? { ok: true as const, value: result }
              : { ok: false as const, failure: result.failure };
          },
          {
            signal: controller.signal,
            task: routingTask,
            onFailover: (record) => {
              console.error('[ai] failing over', {
                fromProvider: record.candidate.provider,
                fromModel: record.candidate.model,
                category: record.failure.category,
                providerCode: record.failure.providerCode,
              });
              // A silent multi-second walk is indistinguishable from the hang this pipeline already
              // has a timeout for. Says "trying a backup model", so automatic recovery reads as
              // recovery rather than as a stall.
              stage('failing-over');
            },
          },
        );

        // Nothing to try at all — distinct from every candidate failing, and with a different fix.
        if ('refused' in walk) {
          const message = CHAIN_REFUSAL_MESSAGE[walk.reason];
          if (window !== null) emitToWindow(window, 'ai:runState', { status: 'error', message });
          return {
            status: 'error',
            code: 'no_key',
            message,
            failure: missingKeyFailure(modelId),
          };
        }

        // The provider and model that actually answered — or that finally failed. Everything
        // downstream reports against these rather than the configured ones, so a card saying
        // "Provider: X · Model: Y" names where the user's failure actually came from.
        const usedProvider = walk.candidate.provider;
        const usedModel = walk.candidate.model;
        // The adapter that answered, kept for the re-ask below.
        const usedAdapter = walk.candidate.adapter;
        // Every model tried before the one being reported, so a total failure renders as ONE
        // consolidated card instead of a sequence the user has to piece together.
        const walkAttempts = walk.attempts.map((record) => ({
          provider: record.candidate.provider,
          model: record.candidate.model,
          category: record.failure.category,
        }));
        // For Provider History: which providers were tried and failed before this one, if any.
        usedCandidate.current = { provider: usedProvider, model: usedModel, attempts: walkAttempts };
        let stream: StreamResult = walk.ok
          ? walk.value
          : { ok: false, message: walk.failure.message, retryable: walk.failure.retryable, failure: walk.failure };

        if (controller.signal.aborted)
          return { status: 'error', code: 'cancelled', message: 'Cancelled.' };
        if (!stream.ok) {
          if (window !== null)
            emitToWindow(window, 'ai:runState', { status: 'error', message: stream.message });
          return {
            status: 'error',
            code: 'provider_error',
            message: stream.message,
            retryable: stream.retryable,
            // The classification the panel renders as a status card. Without it the panel has only
            // the sentence, which is what left provider outages looking like Fixora defects.
            failure: toWireFailure(stream.failure, {
              provider: usedProvider,
              model: usedModel,
              // Drop the final failure from the list: it is already the card's headline, and
              // repeating it as an "also tried" line reads as two separate failures.
              attempts: walkAttempts.slice(0, -1),
            }),
          };
        }

        let response = await finalize(stream.text);
        if (response === SCHEMA_ERROR && wantsStructured) {
          // Re-ask the SAME provider and model that answered. Switching mid-conversation would
          // send a correction about one model's output to a different model, which is incoherent.
          stream = await streamOnce(
            usedAdapter,
            { ...reAskRequest(prepared.request, stream.text, lastFailure.current), model: usedModel },
            controller.signal,
            window,
            false,
          );
          if (stream.ok) response = await finalize(stream.text);
        }
        if (response === SCHEMA_ERROR) {
          const failure: ParseFailureInfo = lastFailure.current ?? {
            reason: 'unknown',
            detail: 'The response could not be parsed and no reason was recorded.',
            recovery: [],
            text: '',
          };
          // The raw response, on disk, whenever parsing fails. Without it "the model returned
          // something invalid" is unfalsifiable — nobody can see what it actually returned.
          const debugPath = writeParseFailureDump({
            model: prepared.request.model,
            profile: request.profile,
            failure,
          });
          // `detail` belongs HERE and only here. It was previously omitted from this log and used as
          // the user's error message instead — exactly backwards: the field-level schema diagnostic
          // ("repairedCode: Required") is the most useful thing a maintainer can have and the least
          // useful thing a user can read.
          console.error('[ai] parse failed', {
            model: prepared.request.model,
            profile: request.profile,
            reason: failure.reason,
            detail: failure.detail,
            recovery: failure.recovery,
            textLength: failure.text.length,
            dump: debugPath,
          });
          // What the USER sees: what happened, and what to do. No schema vocabulary, no field paths,
          // and above all no absolute filesystem path — this codebase treats those as user data
          // (Security §9), and the old message pasted one straight into the panel. The dump still
          // exists for a bug report; the log above names it.
          const message = describeSchemaFailureForUser(request.profile);
          if (window !== null) emitToWindow(window, 'ai:runState', { status: 'error', message });
          return {
            status: 'error',
            code: 'schema_error',
            message,
            retryable: true,
            // The model, not the engine and not the user's code. Attributing this to Fixora is the
            // specific mistake the layer field exists to prevent.
            failure: toWireFailure(describeModelOutputFailure('schema-mismatch'), {
              provider: usedProvider,
              model: usedModel,
              attempts: walkAttempts,
            }),
          };
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

/**
 * Write the unparseable response to disk and return its path.
 *
 * A parse failure is the one error where the evidence is destroyed by default: the text existed only
 * in memory, so "the model returned something invalid" could never be checked by the person it
 * happened to. The dump makes it checkable. Best-effort by design — a failed write must not replace
 * the real error with a filesystem error.
 */
function writeParseFailureDump(input: {
  model: string;
  profile: string;
  failure: { reason: string; detail: string; recovery: readonly string[]; text: string };
}): string | null {
  try {
    const dir = join(app.getPath('userData'), 'debug', 'ai-parse-failures');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(dir, `${stamp}-${input.profile}.json`);
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          at: new Date().toISOString(),
          model: input.model,
          profile: input.profile,
          reason: input.failure.reason,
          detail: input.failure.detail,
          recoveryAttempted: input.failure.recovery,
          rawResponse: input.failure.text,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    return file;
  } catch {
    return null;
  }
}
